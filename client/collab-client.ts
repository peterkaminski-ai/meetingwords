import { ElementIdGenerator, type ElementId } from "articulated";
import {
  applyMutations,
  loadCollabState,
  type CollabState,
} from "../src/collab/core";
import type {
  ClientMutation,
  SelectionState,
  ServerMessage,
  ServerHelloMessage,
} from "../src/collab/types";

// ---------------------------------------------------------------------------
// Browser side of the collaboration protocol. Bundled by esbuild; imports the
// SAME core module the Durable Object runs, so mutation semantics are shared.
//
// Optimism via rollback/replay: `confirmed` mirrors the server exactly (only
// broadcast ops are applied to it, in broadcast order); `view` = confirmed +
// pending local mutations replayed. articulated's IdList is a persistent data
// structure, so the replay never mutates `confirmed` — reconciliation is one
// applyMutations call, not a deep clone.
// ---------------------------------------------------------------------------

export type CollabCallbacks = {
  /** View text changed (local or remote). */
  onText: (text: string) => void;
  onTitle?: (title: string) => void;
  onPresence?: (p: {
    clientId: string;
    name: string;
    color: string;
    kind: string;
    selection: SelectionState | null;
    /** Selection head as a current view-text index (null when no selection). */
    index: number | null;
    /** Selection anchor likewise — equals `index` for a bare caret. */
    anchorIndex: number | null;
  }) => void;
  onPresenceLeave?: (clientId: string) => void;
  onRoster?: (participants: Array<{ clientId: string; name: string; color: string; kind: string }>) => void;
  onThreadsUpdated?: () => void;
  onUpdated?: () => void;
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void;
};

export class CollabSession {
  private ws: WebSocket | null = null;
  private confirmed: CollabState | null = null;
  private pending: ClientMutation[] = [];
  private view: CollabState | null = null;
  private clientId = "";
  private clientCounter = 0;
  private generator = new ElementIdGenerator(() => crypto.randomUUID());
  private lastInsertId: ElementId | null = null;
  private reconnectDelay = 500;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private wsUrl: string,
    private callbacks: CollabCallbacks,
  ) {}

  connect() {
    this.closed = false;
    this.callbacks.onStatus?.("connecting");
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectDelay = 500;
      this.callbacks.onStatus?.("connected");
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, 25_000);
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data === "pong") return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handle(message);
    });

    const scheduleReconnect = () => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (this.closed) return;
      this.callbacks.onStatus?.("disconnected");
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
    };
    ws.addEventListener("close", scheduleReconnect);
    ws.addEventListener("error", () => ws.close());
  }

  close() {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }

  get text(): string {
    return this.view?.text ?? "";
  }

  get ready(): boolean {
    return this.view !== null;
  }

  // -- inbound ------------------------------------------------------------------

  private handle(message: ServerMessage) {
    switch (message.type) {
      case "hello":
        this.handleHello(message);
        break;
      case "mutation": {
        if (!this.confirmed) return;
        this.confirmed = applyMutations(this.confirmed, message.ops).state;
        this.confirmed = { ...this.confirmed, serverCounter: message.serverCounter };
        if (message.senderId === this.clientId) {
          this.pending = this.pending.filter((m) => m.clientCounter > message.senderCounter);
        }
        this.rebuildView();
        break;
      }
      case "checkpoint": {
        this.confirmed = loadCollabState({
          idList: message.idList as never,
          text: message.text,
          serverCounter: message.serverCounter,
        });
        this.rebuildView();
        break;
      }
      case "presence": {
        const sel = message.selection;
        const index = sel && this.view ? safeCursorIndex(this.view, sel.head) : null;
        const anchorIndex = sel && this.view ? safeCursorIndex(this.view, sel.anchor) : null;
        this.callbacks.onPresence?.({ ...message, index, anchorIndex });
        break;
      }
      case "presence-leave":
        this.callbacks.onPresenceLeave?.(message.clientId);
        break;
      case "roster":
        this.callbacks.onRoster?.(message.participants);
        break;
      case "threads-updated":
        this.callbacks.onThreadsUpdated?.();
        break;
      case "updated":
        this.callbacks.onUpdated?.();
        break;
    }
  }

  private handleHello(message: ServerHelloMessage) {
    if (message.clientId) this.clientId = message.clientId;
    this.confirmed = loadCollabState({
      idList: message.idList as never,
      text: message.text,
      serverCounter: message.serverCounter,
    });
    this.callbacks.onTitle?.(message.title);
    // Replay prunes pending ops that reference ids this server state has
    // never seen (e.g. after a full overwrite) — resend only what survives,
    // or a bad op would bounce hello/resend forever.
    this.rebuildView();
    if (this.pending.length > 0) {
      this.sendMutations(this.pending);
    }
  }

  private rebuildView() {
    if (!this.confirmed) return;
    let view = this.confirmed;
    if (this.pending.length > 0) {
      const kept: ClientMutation[] = [];
      for (const mutation of this.pending) {
        try {
          view = applyMutations(view, [mutation]).state;
          kept.push(mutation);
        } catch {
          // References an id the server no longer knows (post-resync) — drop.
        }
      }
      this.pending = kept;
    }
    this.view = view;
    this.callbacks.onText(view.text);
  }

  // -- outbound -------------------------------------------------------------------

  /**
   * The local textarea changed: chars [start, start+removed) were replaced by
   * `inserted`. Coordinates are in the CURRENT view text (pre-change).
   */
  localEdit(start: number, removed: number, inserted: string) {
    if (!this.view) return;
    const mutations: ClientMutation[] = [];

    if (removed > 0) {
      mutations.push({
        name: "delete",
        clientCounter: ++this.clientCounter,
        args: {
          startId: this.view.idList.at(start),
          endId: this.view.idList.at(start + removed - 1),
        },
      });
    }
    if (inserted.length > 0) {
      const before = start > 0 ? this.view.idList.at(start - 1) : null;
      const id = this.generator.generateAfter(this.lastInsertId ?? before, inserted.length);
      this.lastInsertId = { bunchId: id.bunchId, counter: id.counter + inserted.length - 1 };
      mutations.push({
        name: "insert",
        clientCounter: ++this.clientCounter,
        args: { before, id, content: inserted },
      });
    }
    if (mutations.length === 0) return;

    this.pending.push(...mutations);
    this.view = applyMutations(this.view, mutations).state;
    this.sendMutations(mutations);
  }

  private sendMutations(mutations: ClientMutation[]) {
    if (this.ws?.readyState === WebSocket.OPEN && this.clientId) {
      this.ws.send(JSON.stringify({ type: "mutation", clientId: this.clientId, mutations }));
    }
  }

  sendPresence(selectionStart: number | null, selectionEnd: number | null) {
    if (!this.view || !this.clientId || this.ws?.readyState !== WebSocket.OPEN) return;
    const selection: SelectionState | null =
      selectionStart === null || selectionEnd === null
        ? null
        : {
            anchor: this.view.idList.cursorAt(Math.min(selectionStart, this.view.text.length)),
            head: this.view.idList.cursorAt(Math.min(selectionEnd, this.view.text.length)),
          };
    this.ws.send(JSON.stringify({ type: "presence", clientId: this.clientId, selection }));
  }

  /** Map a view-text index to a stable cursor and back (caret preservation). */
  cursorAt(index: number): ElementId | null {
    return this.view ? this.view.idList.cursorAt(Math.min(index, this.view.text.length)) : null;
  }

  indexOfCursor(cursor: ElementId | null): number {
    return this.view ? this.view.idList.cursorIndex(cursor) : 0;
  }
}

function safeCursorIndex(state: CollabState, cursor: ElementId | null): number | null {
  try {
    return state.idList.cursorIndex(cursor);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Textarea binding: diff-based local edit capture + caret-stable remote apply.
// ---------------------------------------------------------------------------

export type EditorHandle = {
  session: CollabSession;
  destroy: () => void;
};

export function bindTextarea(
  textarea: HTMLTextAreaElement,
  wsUrl: string,
  callbacks: Omit<CollabCallbacks, "onText"> & { onText?: (text: string) => void },
): EditorHandle {
  let applyingRemote = false;
  let shadow = "";

  const session = new CollabSession(wsUrl, {
    ...callbacks,
    onText: (text) => {
      if (text !== textarea.value) {
        applyingRemote = true;
        const selStart = textarea.selectionStart;
        const selEnd = textarea.selectionEnd;
        const anchorCursor = session.cursorAt(selStart);
        const headCursor = session.cursorAt(selEnd);
        textarea.value = text;
        try {
          textarea.selectionStart = session.indexOfCursor(anchorCursor);
          textarea.selectionEnd = session.indexOfCursor(headCursor);
        } catch {
          // caret restore is best-effort
        }
        applyingRemote = false;
      }
      shadow = text;
      callbacks.onText?.(text);
    },
  });

  const onInput = () => {
    if (applyingRemote || !session.ready) return;
    const next = textarea.value;
    const edit = diffStrings(shadow, next);
    if (edit) {
      session.localEdit(edit.start, edit.removed, edit.inserted);
      shadow = next;
    }
  };

  let presenceTimer: ReturnType<typeof setTimeout> | null = null;
  const onSelect = () => {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      session.sendPresence(textarea.selectionStart, textarea.selectionEnd);
    }, 120);
  };

  textarea.addEventListener("input", onInput);
  textarea.addEventListener("keyup", onSelect);
  textarea.addEventListener("click", onSelect);
  textarea.addEventListener("select", onSelect);

  session.connect();

  return {
    session,
    destroy: () => {
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("keyup", onSelect);
      textarea.removeEventListener("click", onSelect);
      textarea.removeEventListener("select", onSelect);
      session.close();
    },
  };
}

/** Single-span diff via common prefix/suffix — exactly what textarea edits produce. */
export function diffStrings(
  oldStr: string,
  newStr: string,
): { start: number; removed: number; inserted: string } | null {
  if (oldStr === newStr) return null;
  let prefix = 0;
  const minLen = Math.min(oldStr.length, newStr.length);
  while (prefix < minLen && oldStr[prefix] === newStr[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldStr[oldStr.length - 1 - suffix] === newStr[newStr.length - 1 - suffix]
  ) {
    suffix++;
  }
  return {
    start: prefix,
    removed: oldStr.length - prefix - suffix,
    inserted: newStr.slice(prefix, newStr.length - suffix),
  };
}
