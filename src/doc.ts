import { DurableObject } from "cloudflare:workers";
import {
  applyMutations,
  collabFromText,
  lineAnchors,
  loadCollabState,
  newCollabState,
  saveCollabState,
  type CollabState,
  type SavedCollabState,
} from "./collab/core";
import { resolveTextEdits, type TextEdit } from "./collab/edits";
import type {
  AppliedOp,
  ClientMessage,
  ClientMutationMessage,
  CommentAnchor,
  CommentThread,
  ParticipantKind,
  ServerHelloMessage,
  ServerMessage,
  ServerMutationMessage,
  ShareAccess,
} from "./collab/types";
import { shortId } from "./auth";
import { registryStub } from "./registry";
import { H_ACCESS, H_AGENT, H_GUEST_ID, H_GUEST_NAME, H_ROLE, type Env } from "./env";

// ---------------------------------------------------------------------------
// Doc: one Durable Object per document — the document's single
// authority. Holds collab state in memory while awake, applies mutations in
// arrival order, fans out applied ops over hibernation-friendly WebSockets,
// persists (debounced) to DO storage, and keeps the D1 index row fresh.
// ---------------------------------------------------------------------------

type DocMeta = {
  id: string;
  title: string;
  shareId: string;
  shareAccess: ShareAccess;
  createdAt: string;
  updatedAt: string;
};

/** Per-connection state; survives hibernation via serializeAttachment. */
type ConnState = {
  clientId: string;
  kind: ParticipantKind;
  /** What this connection may do: owner, or the share access at connect time. */
  access: "owner" | ShareAccess;
  name: string;
  color: string;
  guestId: string | null;
  selection?: unknown;
};

type OplogEntry = { c: number; op: AppliedOp };

const CURSOR_COLORS = ["#4285f4", "#ea4335", "#34a853", "#f4b400", "#9c27b0", "#ff6d00", "#00bcd4", "#e91e63"];
const PERSIST_DEBOUNCE_MS = 250;
const PERSIST_MAX_BATCHES = 50;
const CHECKPOINT_MAX_MUTATIONS = 50;
const CHECKPOINT_MAX_MS = 2000;
const OPLOG_MAX_ENTRIES = 300;
const OPLOG_MAX_JSON = 90_000;
const INDEX_SYNC_MIN_MS = 10_000;

export class Doc extends DurableObject<Env> {
  private meta: DocMeta | null | undefined; // undefined = not yet loaded
  private collab: CollabState | undefined;
  private threads: CommentThread[] | undefined;
  private oplog: OplogEntry[] | undefined;

  // Volatile (reset on hibernation — all are optimizations, not correctness):
  private clientAcks = new Map<string, number>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingBatches = 0;
  private checkpointMutations = 0;
  private checkpointLastAt = 0;
  private indexLastSyncAt = 0;
  private indexLastSnapshot = "";
  private colorIndex = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // App-level keepalive that doesn't wake the DO.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // -- storage hydration ----------------------------------------------------

  private async hydrate(): Promise<boolean> {
    if (this.meta !== undefined) return this.meta !== null;
    const [meta, collab, threads, oplog] = await Promise.all([
      this.ctx.storage.get<DocMeta>("meta"),
      this.ctx.storage.get<SavedCollabState>("collab"),
      this.ctx.storage.get<CommentThread[]>("threads"),
      this.ctx.storage.get<OplogEntry[]>("oplog"),
    ]);
    this.meta = meta ?? null;
    this.collab = collab ? loadCollabState(collab) : newCollabState();
    this.threads = threads ?? [];
    this.oplog = oplog ?? [];
    return this.meta !== null;
  }

  private schedulePersist() {
    this.pendingBatches++;
    if (this.pendingBatches >= PERSIST_MAX_BATCHES) {
      void this.flushPersist();
      return;
    }
    if (this.persistTimer === null) {
      // Fixed cadence — continuous typing still flushes every DEBOUNCE ms.
      this.persistTimer = setTimeout(() => void this.flushPersist(), PERSIST_DEBOUNCE_MS);
    }
  }

  private async flushPersist() {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.pendingBatches = 0;
    if (!this.meta || !this.collab) return;

    this.trimOplog();
    await this.ctx.storage.put({
      meta: this.meta,
      collab: saveCollabState(this.collab),
      threads: this.threads ?? [],
      oplog: this.oplog ?? [],
    });
    await this.syncIndex(false);
  }

  private trimOplog() {
    if (!this.oplog) return;
    if (this.oplog.length > OPLOG_MAX_ENTRIES) {
      this.oplog = this.oplog.slice(-OPLOG_MAX_ENTRIES);
    }
    let json = JSON.stringify(this.oplog).length;
    while (json > OPLOG_MAX_JSON && this.oplog.length > 1) {
      json -= JSON.stringify(this.oplog.shift()).length + 1;
    }
  }

  /** Keep the cross-document index row fresh (title/snippet/share/updated).
   * An upsert, so the Registry index self-heals if it is ever lost. */
  private async syncIndex(force: boolean) {
    if (!this.meta || !this.collab) return;
    const snippet = this.collab.text.replace(/\s+/g, " ").trim().slice(0, 140);
    const snapshot = `${this.meta.title} ${snippet} ${this.meta.shareAccess}`;
    const due = Date.now() - this.indexLastSyncAt >= INDEX_SYNC_MIN_MS;
    if (!force && !due && snapshot === this.indexLastSnapshot) return;
    this.indexLastSyncAt = Date.now();
    this.indexLastSnapshot = snapshot;
    await registryStub(this.env).docSync(this.meta.id, {
      title: this.meta.title,
      snippet,
      shareId: this.meta.shareId,
      shareAccess: this.meta.shareAccess,
      createdAt: this.meta.createdAt,
      updatedAt: this.meta.updatedAt,
    });
  }

  private touch() {
    if (this.meta) this.meta.updatedAt = new Date().toISOString();
  }

  // -- HTTP entry point (internal: called only by the Worker) ---------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/init" && request.method === "POST") {
      return this.handleInit(request);
    }

    const exists = await this.hydrate();
    if (!exists) return json({ ok: false, error: "Document not found." }, 404);

    if (path === "/ws") return this.handleUpgrade(request, url);
    if (path === "/state" && request.method === "GET") return this.handleState(request);
    if (path === "/read" && request.method === "GET") return this.handleRead(url);
    if (path === "/doc" && request.method === "PUT") return this.handlePut(request);
    if (path === "/doc" && request.method === "DELETE") return this.handleDelete();
    if (path === "/edit" && request.method === "POST") return this.handleEdit(request);
    if (path === "/changes" && request.method === "GET") return this.handleChanges(url);
    if (path === "/threads" && request.method === "POST") return this.handleThreadCreate(request);

    const threadMatch = path.match(/^\/threads\/([a-z0-9]+)(\/replies)?$/);
    if (threadMatch) return this.handleThreadOp(request, threadMatch[1], Boolean(threadMatch[2]));
    const messageMatch = path.match(/^\/messages\/([a-z0-9]+)$/);
    if (messageMatch) return this.handleMessageOp(request, messageMatch[1]);

    return json({ ok: false, error: "Not found." }, 404);
  }

  private async handleInit(request: Request): Promise<Response> {
    await this.hydrate();
    if (this.meta) return json({ ok: false, error: "Already initialized." }, 400);
    const body = (await request.json()) as { id: string; shareId: string; title?: string; markdown?: string };
    const now = new Date().toISOString();
    this.meta = {
      id: body.id,
      title: body.title || "untitled",
      shareId: body.shareId,
      shareAccess: "none",
      createdAt: now,
      updatedAt: now,
    };
    this.collab = collabFromText(body.markdown || "");
    this.threads = [];
    this.oplog = [];
    await this.flushPersist();
    return json({ ok: true });
  }

  // -- WebSocket lifecycle ----------------------------------------------------

  private handleUpgrade(request: Request, url: URL): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ ok: false, error: "Expected WebSocket upgrade." }, 426);
    }
    const role = request.headers.get(H_ROLE);
    const access = request.headers.get(H_ACCESS) as ConnState["access"] | null;
    if (!role || !access) return json({ ok: false, error: "Missing auth context." }, 400);

    const meta = this.meta!;
    if (role !== "owner") {
      if (meta.shareAccess === "none") return json({ ok: false, error: "Not shared." }, 403);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const guestName = decodeURIComponent(request.headers.get(H_GUEST_NAME) || "");
    const conn: ConnState = {
      clientId: `c-${shortId(8)}`,
      kind: role === "owner" ? "owner" : "guest",
      access: role === "owner" ? "owner" : meta.shareAccess,
      name: role === "owner" ? "Owner" : guestName || "Anonymous",
      color: CURSOR_COLORS[this.colorIndex++ % CURSOR_COLORS.length],
      guestId: request.headers.get(H_GUEST_ID),
    };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(conn);

    this.send(server, { ...this.helloMessage(), clientId: conn.clientId });
    this.sendExistingPresence(server, conn);
    this.broadcastRoster();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string") return;
    const conn = ws.deserializeAttachment() as ConnState | null;
    if (!conn) return;

    let message: ClientMessage;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    if (message.type === "presence") {
      if (message.clientId !== conn.clientId) return;
      conn.selection = message.selection;
      ws.serializeAttachment(conn);
      this.broadcast(
        {
          type: "presence",
          clientId: conn.clientId,
          name: conn.name,
          color: conn.color,
          kind: conn.kind,
          selection: message.selection,
        },
        (other) => other !== ws && this.canEdit(this.connOf(other)),
      );
      return;
    }

    if (message.type === "mutation") {
      await this.handleMutationMessage(ws, conn, message);
    }
  }

  private async handleMutationMessage(ws: WebSocket, conn: ConnState, message: ClientMutationMessage) {
    if (message.clientId !== conn.clientId) return;
    if (!this.canEdit(conn)) return;
    if (!Array.isArray(message.mutations) || message.mutations.length === 0) return;

    await this.hydrate();
    const collab = this.collab!;

    const senderCounter = message.mutations.at(-1)?.clientCounter ?? 0;
    const lastAck = this.clientAcks.get(conn.clientId) ?? 0;
    const fresh = message.mutations.filter((m) => m.clientCounter > lastAck);

    const ack = (ops: AppliedOp[]) => {
      const reply: ServerMutationMessage = {
        type: "mutation",
        senderId: conn.clientId,
        senderCounter,
        serverCounter: this.collab!.serverCounter,
        ops,
      };
      return reply;
    };

    if (fresh.length === 0) {
      this.send(ws, ack([]));
      return;
    }

    let result;
    try {
      result = applyMutations(collab, fresh);
    } catch {
      // Drifted or misbehaving client: resync it, don't poison the doc.
      this.send(ws, { ...this.helloMessage(), clientId: conn.clientId });
      return;
    }
    this.clientAcks.set(conn.clientId, senderCounter);

    if (!result.changed) {
      this.send(ws, ack([]));
      return;
    }

    this.collab = result.state;
    this.appendOplog(result.applied);
    this.touch();
    this.schedulePersist();

    this.broadcastMutation(ack(result.applied));
    this.maybeCheckpoint();
    this.broadcastViewersUpdated();
  }

  async webSocketClose(ws: WebSocket) {
    this.handleGone(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.handleGone(ws);
  }

  private handleGone(ws: WebSocket) {
    const conn = this.connOf(ws);
    if (conn) {
      this.broadcast({ type: "presence-leave", clientId: conn.clientId }, (other) => other !== ws);
    }
    this.broadcastRoster(ws);
    // Last one out flushes the debounced write.
    if (this.ctx.getWebSockets().filter((other) => other !== ws).length === 0) {
      void this.flushPersist();
    }
  }

  // -- broadcast helpers ------------------------------------------------------

  private connOf(ws: WebSocket): ConnState | null {
    try {
      return ws.deserializeAttachment() as ConnState;
    } catch {
      return null;
    }
  }

  private canEdit(conn: ConnState | null): boolean {
    return conn !== null && (conn.access === "owner" || conn.access === "edit");
  }

  private send(ws: WebSocket, message: ServerMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket already gone; close events will clean up.
    }
  }

  /** Serialize once, fan out to every socket passing the filter. */
  private broadcast(message: ServerMessage, filter?: (ws: WebSocket) => boolean) {
    const raw = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (filter && !filter(ws)) continue;
      try {
        ws.send(raw);
      } catch {
        // ignore
      }
    }
  }

  private helloMessage(): ServerHelloMessage {
    const meta = this.meta!;
    const collab = this.collab!;
    return {
      type: "hello",
      docId: meta.id,
      title: meta.title,
      shareId: meta.shareId,
      shareAccess: meta.shareAccess,
      text: collab.text,
      idList: collab.idList.save(),
      serverCounter: collab.serverCounter,
    };
  }

  private sendExistingPresence(target: WebSocket, targetConn: ConnState) {
    if (!this.canEdit(targetConn)) return;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === target) continue;
      const conn = this.connOf(ws);
      if (!conn || !this.canEdit(conn) || conn.selection === undefined) continue;
      this.send(target, {
        type: "presence",
        clientId: conn.clientId,
        name: conn.name,
        color: conn.color,
        kind: conn.kind,
        selection: conn.selection as ServerMessage extends never ? never : any,
      });
    }
  }

  private broadcastMutation(message: ServerMutationMessage) {
    this.broadcast(message, (ws) => this.canEdit(this.connOf(ws)));
  }

  private maybeCheckpoint() {
    const now = Date.now();
    this.checkpointMutations++;
    if (
      this.checkpointMutations >= CHECKPOINT_MAX_MUTATIONS ||
      now - this.checkpointLastAt >= CHECKPOINT_MAX_MS
    ) {
      this.checkpointMutations = 0;
      this.checkpointLastAt = now;
      const collab = this.collab!;
      this.broadcast(
        {
          type: "checkpoint",
          text: collab.text,
          idList: collab.idList.save(),
          serverCounter: collab.serverCounter,
        },
        (ws) => this.canEdit(this.connOf(ws)),
      );
    }
  }

  /** View-only connections re-render on this signal. */
  private broadcastViewersUpdated() {
    const meta = this.meta!;
    this.broadcast(
      { type: "updated", docId: meta.id, updatedAt: meta.updatedAt },
      (ws) => !this.canEdit(this.connOf(ws)),
    );
  }

  private broadcastThreadsUpdated() {
    this.broadcast({ type: "threads-updated", docId: this.meta!.id });
  }

  private broadcastRoster(excluding?: WebSocket) {
    const participants = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excluding) continue;
      const conn = this.connOf(ws);
      if (!conn) continue;
      participants.push({ clientId: conn.clientId, name: conn.name, color: conn.color, kind: conn.kind });
    }
    this.broadcast({ type: "roster", participants }, (ws) => ws !== excluding);
  }

  private appendOplog(ops: AppliedOp[]) {
    if (!this.oplog) this.oplog = [];
    let c = this.collab!.serverCounter - ops.length;
    for (const op of ops) {
      this.oplog.push({ c: ++c, op });
    }
  }

  // -- document REST (via Worker) --------------------------------------------

  private async handleState(request: Request): Promise<Response> {
    const meta = this.meta!;
    const collab = this.collab!;
    const role = request.headers.get(H_ROLE);
    const includeCollab = role === "owner" || meta.shareAccess === "edit";
    return json({
      ok: true,
      doc: {
        id: meta.id,
        title: meta.title,
        shareId: meta.shareId,
        shareAccess: meta.shareAccess,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        markdown: collab.text,
        serverCounter: collab.serverCounter,
        ...(includeCollab ? { collab: { idList: collab.idList.save() } } : {}),
      },
      threads: this.threads ?? [],
    });
  }

  /** Line-window read for context-budgeted agents. */
  private handleRead(url: URL): Response {
    const collab = this.collab!;
    const lines = collab.text.split("\n");
    const offset = Math.max(1, Number(url.searchParams.get("offset") || 1));
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.max(1, Number(limitParam)) : lines.length;
    const start = offset - 1;
    const slice = lines.slice(start, start + limit);
    const withAnchors = ["1", "true"].includes(url.searchParams.get("anchors") || "");
    return json({
      ok: true,
      doc: {
        id: this.meta!.id,
        title: this.meta!.title,
        serverCounter: collab.serverCounter,
        totalLines: lines.length,
        offset,
        limit: slice.length,
        remaining: Math.max(0, lines.length - (start + slice.length)),
        content: slice.map((line, i) => `${start + i + 1}: ${line}`).join("\n"),
        ...(withAnchors ? { anchors: lineAnchors(collab, offset, slice.length) } : {}),
      },
    });
  }

  private async handlePut(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      title?: string;
      markdown?: string;
      shareAccess?: ShareAccess;
    };
    const meta = this.meta!;

    const titleChanged = body.title !== undefined && normalizeTitle(body.title) !== meta.title;
    if (body.title !== undefined) meta.title = normalizeTitle(body.title);

    const shareChanged =
      body.shareAccess !== undefined &&
      ["none", "view", "comment", "edit"].includes(body.shareAccess) &&
      body.shareAccess !== meta.shareAccess;
    if (shareChanged) meta.shareAccess = body.shareAccess!;

    const markdownChanged = body.markdown !== undefined && body.markdown !== this.collab!.text;
    if (markdownChanged) {
      // Full overwrite: new id epoch. Clear the oplog so changes-pollers and
      // reconnecting editors resync from the snapshot instead of stitching.
      this.collab = collabFromText(body.markdown!, this.collab!.serverCounter + 1);
      this.oplog = [];
      this.clientAcks.clear();
    }

    this.touch();
    await this.flushPersist();
    await this.syncIndex(true);

    if (shareChanged) this.enforceShareAccess();
    if (titleChanged || markdownChanged || shareChanged) {
      this.broadcast(this.helloMessage(), (ws) => this.canEdit(this.connOf(ws)));
      this.broadcastViewersUpdated();
      this.broadcastRoster();
    }
    return json({ ok: true, savedAt: meta.updatedAt, shareAccess: meta.shareAccess });
  }

  /** Close connections whose access exceeds a newly-restricted share level. */
  private enforceShareAccess() {
    const meta = this.meta!;
    for (const ws of this.ctx.getWebSockets()) {
      const conn = this.connOf(ws);
      if (!conn || conn.kind === "owner") continue;
      const tooMuch =
        meta.shareAccess === "none" ||
        (conn.access === "edit" && meta.shareAccess !== "edit");
      if (tooMuch) {
        try {
          ws.close(1000, "share access changed");
        } catch {
          // ignore
        }
      }
    }
  }

  private async handleDelete(): Promise<Response> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, "document deleted");
      } catch {
        // ignore
      }
    }
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    await this.ctx.storage.deleteAll();
    this.meta = null;
    this.collab = newCollabState();
    this.threads = [];
    this.oplog = [];
    return json({ ok: true });
  }

  private async handleEdit(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      edits: TextEdit[];
      baseCounter?: number;
      title?: string;
    };
    if (!Array.isArray(body.edits) || body.edits.length === 0) {
      return json({ ok: false, error: "edits must be a non-empty array of {oldText, newText}." }, 400);
    }

    const agentLabel = request.headers.get(H_AGENT);
    const senderId = agentLabel ? `agent:${decodeURIComponent(agentLabel)}` : "api";
    const baseCounter = typeof body.baseCounter === "number" ? body.baseCounter : null;

    const result = resolveTextEdits(this.collab!, body.edits, baseCounter);
    if (!result.ok) {
      return json(
        {
          ok: false,
          errors: result.errors,
          conflicts: result.conflicts,
          serverCounter: this.collab!.serverCounter,
        },
        result.status,
      );
    }

    this.collab = result.state;
    this.appendOplog(result.applied);

    const titleChanged = body.title !== undefined && normalizeTitle(body.title) !== this.meta!.title;
    if (titleChanged) this.meta!.title = normalizeTitle(body.title!);

    this.touch();
    this.schedulePersist();

    if (titleChanged) {
      this.broadcast(this.helloMessage(), (ws) => this.canEdit(this.connOf(ws)));
    } else if (result.applied.length > 0) {
      this.broadcastMutation({
        type: "mutation",
        senderId,
        senderCounter: result.lastCounter,
        serverCounter: this.collab.serverCounter,
        ops: result.applied,
      });
      this.maybeCheckpoint();
      // Agents are participants: flash their presence so humans see who edited.
      if (agentLabel) {
        this.broadcast(
          {
            type: "presence",
            clientId: senderId,
            name: decodeURIComponent(agentLabel),
            color: "#7c4dff",
            kind: "agent",
            selection: null,
          },
          (ws) => this.canEdit(this.connOf(ws)),
        );
      }
    }
    this.broadcastViewersUpdated();

    return json({
      ok: true,
      savedAt: this.meta!.updatedAt,
      serverCounter: this.collab.serverCounter,
    });
  }

  /** Socketless catch-up for agents: ops since a counter, or a resync snapshot. */
  private handleChanges(url: URL): Response {
    const since = Number(url.searchParams.get("since") || 0);
    const collab = this.collab!;
    if (since >= collab.serverCounter) {
      return json({ ok: true, serverCounter: collab.serverCounter, ops: [] });
    }
    const oplog = this.oplog ?? [];
    const covered = oplog.length > 0 && oplog[0].c <= since + 1;
    if (!covered) {
      return json({
        ok: true,
        serverCounter: collab.serverCounter,
        resync: { text: collab.text, idList: collab.idList.save() },
      });
    }
    return json({
      ok: true,
      serverCounter: collab.serverCounter,
      ops: oplog.filter((entry) => entry.c > since),
    });
  }

  // -- comment threads --------------------------------------------------------

  private identity(request: Request): { authorId: string; authorName: string; isOwner: boolean } | null {
    const role = request.headers.get(H_ROLE);
    if (role === "owner") {
      const agent = request.headers.get(H_AGENT);
      return {
        authorId: "__owner__",
        authorName: agent ? decodeURIComponent(agent) : "Owner",
        isOwner: true,
      };
    }
    const guestId = request.headers.get(H_GUEST_ID);
    const guestName = decodeURIComponent(request.headers.get(H_GUEST_NAME) || "");
    if (!guestId || !guestName) return null;
    return { authorId: guestId, authorName: guestName, isOwner: false };
  }

  private async handleThreadCreate(request: Request): Promise<Response> {
    const identity = this.identity(request);
    if (!identity) return json({ ok: false, error: "Set your name first." }, 400);

    const body = (await request.json()) as { anchor?: Partial<CommentAnchor>; quote?: string; body?: string };
    const text = normalizeBody(String(body.body || ""));
    if (!text) return json({ ok: false, error: "Comment body is required." }, 400);

    let anchor: CommentAnchor | null = null;
    if (body.anchor && typeof body.anchor.quote === "string" && body.anchor.quote) {
      anchor = sanitizeAnchor(body.anchor);
    } else if (typeof body.quote === "string" && body.quote) {
      // Convenience for agents: anchor by unique quote.
      const doc = this.collab!.text;
      const start = doc.indexOf(body.quote);
      if (start === -1) return json({ ok: false, error: "Quoted text not found in document." }, 400);
      anchor = {
        quote: body.quote,
        prefix: doc.slice(Math.max(0, start - 32), start),
        suffix: doc.slice(start + body.quote.length, start + body.quote.length + 32),
        start,
        end: start + body.quote.length,
      };
    }
    if (!anchor) return json({ ok: false, error: "Anchor (or quote) is required." }, 400);

    const now = new Date().toISOString();
    const thread: CommentThread = {
      id: shortId(10),
      resolved: false,
      createdAt: now,
      updatedAt: now,
      anchor,
      messages: [
        {
          id: shortId(10),
          parentId: null,
          authorId: identity.authorId,
          authorName: identity.authorName,
          body: text,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    this.threads = [...(this.threads ?? []), thread];
    this.touch();
    await this.flushPersist();
    this.broadcastThreadsUpdated();
    return json({ ok: true, thread: { id: thread.id }, threads: this.threads });
  }

  private async handleThreadOp(request: Request, threadId: string, isReply: boolean): Promise<Response> {
    const threads = this.threads ?? [];
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return json({ ok: false, error: "Thread not found." }, 404);
    const identity = this.identity(request);

    if (isReply && request.method === "POST") {
      if (!identity) return json({ ok: false, error: "Set your name first." }, 400);
      const body = (await request.json()) as { body?: string; parentMessageId?: string };
      const text = normalizeBody(String(body.body || ""));
      if (!text) return json({ ok: false, error: "Reply body is required." }, 400);
      const parentId = body.parentMessageId || thread.messages[0]?.id || "";
      if (!thread.messages.some((m) => m.id === parentId)) {
        return json({ ok: false, error: "Parent message not found." }, 400);
      }
      const now = new Date().toISOString();
      thread.messages.push({
        id: shortId(10),
        parentId,
        authorId: identity.authorId,
        authorName: identity.authorName,
        body: text,
        createdAt: now,
        updatedAt: now,
      });
      thread.updatedAt = now;
      this.touch();
      await this.flushPersist();
      this.broadcastThreadsUpdated();
      return json({ ok: true, threads: this.threads });
    }

    if (!isReply && request.method === "PATCH") {
      if (!this.canManageThread(identity, thread)) return json({ ok: false, error: "Not allowed." }, 403);
      const body = (await request.json()) as { resolved?: boolean };
      thread.resolved = Boolean(body.resolved);
      thread.updatedAt = new Date().toISOString();
      this.touch();
      await this.flushPersist();
      this.broadcastThreadsUpdated();
      return json({ ok: true, threads: this.threads });
    }

    if (!isReply && request.method === "DELETE") {
      if (!identity?.isOwner) return json({ ok: false, error: "Only the owner can delete a thread." }, 403);
      this.threads = threads.filter((t) => t.id !== threadId);
      this.touch();
      await this.flushPersist();
      this.broadcastThreadsUpdated();
      return json({ ok: true, threads: this.threads });
    }

    return json({ ok: false, error: "Not found." }, 404);
  }

  private async handleMessageOp(request: Request, messageId: string): Promise<Response> {
    const threads = this.threads ?? [];
    let found: { thread: CommentThread; message: CommentThread["messages"][number] } | null = null;
    for (const thread of threads) {
      const message = thread.messages.find((m) => m.id === messageId);
      if (message) {
        found = { thread, message };
        break;
      }
    }
    if (!found) return json({ ok: false, error: "Message not found." }, 404);

    const identity = this.identity(request);
    const mayManage =
      identity && (identity.isOwner || identity.authorId === found.message.authorId);
    if (!mayManage) return json({ ok: false, error: "Not allowed." }, 403);

    if (request.method === "PATCH") {
      const body = (await request.json()) as { body?: string };
      const text = normalizeBody(String(body.body || ""));
      if (!text) return json({ ok: false, error: "Body is required." }, 400);
      found.message.body = text;
      found.message.updatedAt = new Date().toISOString();
      found.thread.updatedAt = found.message.updatedAt;
    } else if (request.method === "DELETE") {
      found.thread.messages = found.thread.messages.filter((m) => m.id !== messageId);
      if (found.thread.messages.length === 0) {
        this.threads = threads.filter((t) => t.id !== found!.thread.id);
      } else {
        found.thread.updatedAt = new Date().toISOString();
      }
    } else {
      return json({ ok: false, error: "Not found." }, 404);
    }

    this.touch();
    await this.flushPersist();
    this.broadcastThreadsUpdated();
    return json({ ok: true, threads: this.threads });
  }

  private canManageThread(
    identity: { authorId: string; isOwner: boolean } | null,
    thread: CommentThread,
  ): boolean {
    if (!identity) return false;
    if (identity.isOwner) return true;
    return thread.messages[0]?.authorId === identity.authorId;
  }
}

function normalizeTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t || "untitled";
}

function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim().slice(0, 10_000);
}

function sanitizeAnchor(anchor: Partial<CommentAnchor>): CommentAnchor | null {
  if (typeof anchor.quote !== "string" || !anchor.quote) return null;
  return {
    quote: anchor.quote.slice(0, 2000),
    prefix: typeof anchor.prefix === "string" ? anchor.prefix.slice(-64) : "",
    suffix: typeof anchor.suffix === "string" ? anchor.suffix.slice(0, 64) : "",
    start: Number.isFinite(anchor.start) ? Number(anchor.start) : 0,
    end: Number.isFinite(anchor.end) ? Number(anchor.end) : 0,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
