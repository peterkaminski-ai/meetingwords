import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { ShareAccess } from "./collab/types";

// ---------------------------------------------------------------------------
// Registry: a singleton Durable Object holding everything that used to live
// in D1 — the cross-document index, owner auth (password, device tokens),
// and agent API keys — in the DO's native SQLite storage.
//
// Why: D1 is a Cloudflare-hosted service; DO SQLite is part of the runtime.
// With the Registry, the whole app runs identically on Cloudflare and on a
// self-hosted workerd/miniflare — one codebase, no emulated services. The
// Worker (and Doc DOs) call it via RPC.
// ---------------------------------------------------------------------------

export type DocIndexRow = {
  id: string;
  title: string;
  snippet: string;
  share_id: string;
  share_access: ShareAccess;
  created_at: string;
  updated_at: string;
};

export type KeyRow = { id: string; label: string; created_at: string };

const TOKEN_TOUCH_MIN_MS = 3_600_000;

export class Registry extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL, last_used_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY, label TEXT NOT NULL,
        hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'untitled',
        snippet TEXT NOT NULL DEFAULT '', share_id TEXT UNIQUE NOT NULL,
        share_access TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS docs_updated ON docs (updated_at DESC);
    `);
  }

  // -- settings ---------------------------------------------------------------

  async settingsGet(key: string): Promise<string | null> {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0];
    return row?.value ?? null;
  }

  async settingsPut(key: string, value: string): Promise<void> {
    this.sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  async settingsDelete(key: string): Promise<void> {
    this.sql.exec("DELETE FROM settings WHERE key = ?", key);
  }

  // -- device tokens ------------------------------------------------------------

  async tokenInsert(id: string, hash: string, now: string): Promise<void> {
    this.sql.exec("INSERT INTO tokens (id, hash, created_at, last_used_at) VALUES (?, ?, ?, ?)", id, hash, now, now);
  }

  async tokenVerify(hash: string, now: string): Promise<boolean> {
    const row = this.sql
      .exec<{ id: string; last_used_at: string }>("SELECT id, last_used_at FROM tokens WHERE hash = ?", hash)
      .toArray()[0];
    if (!row) return false;
    if (Date.parse(now) - Date.parse(row.last_used_at) > TOKEN_TOUCH_MIN_MS) {
      this.sql.exec("UPDATE tokens SET last_used_at = ? WHERE id = ?", now, row.id);
    }
    return true;
  }

  async tokenDelete(hash: string): Promise<void> {
    this.sql.exec("DELETE FROM tokens WHERE hash = ?", hash);
  }

  /** Sign out every device except the caller's (password change). */
  async tokenDeleteAllExcept(hash: string): Promise<void> {
    this.sql.exec("DELETE FROM tokens WHERE hash != ?", hash);
  }

  /** Sign out every device (fleet owner reset). */
  async tokenDeleteAll(): Promise<void> {
    this.sql.exec("DELETE FROM tokens");
  }

  // -- agent API keys -------------------------------------------------------------

  async keyVerify(hash: string): Promise<string | null> {
    const row = this.sql.exec<{ label: string }>("SELECT label FROM api_keys WHERE hash = ?", hash).toArray()[0];
    return row?.label ?? null;
  }

  async keyList(): Promise<KeyRow[]> {
    return this.sql.exec<KeyRow>("SELECT id, label, created_at FROM api_keys ORDER BY created_at").toArray();
  }

  async keyInsert(id: string, label: string, hash: string, now: string): Promise<void> {
    this.sql.exec("INSERT INTO api_keys (id, label, hash, created_at) VALUES (?, ?, ?, ?)", id, label, hash, now);
  }

  async keyDelete(id: string): Promise<boolean> {
    return this.sql.exec("DELETE FROM api_keys WHERE id = ?", id).rowsWritten > 0;
  }

  // -- docs index -------------------------------------------------------------------

  async docsList(q: string): Promise<DocIndexRow[]> {
    if (q) {
      const like = `%${q}%`;
      return this.sql
        .exec<DocIndexRow>(
          "SELECT id, title, snippet, share_id, share_access, created_at, updated_at FROM docs WHERE title LIKE ? OR snippet LIKE ? ORDER BY updated_at DESC LIMIT 200",
          like,
          like,
        )
        .toArray();
    }
    return this.sql
      .exec<DocIndexRow>(
        "SELECT id, title, snippet, share_id, share_access, created_at, updated_at FROM docs ORDER BY updated_at DESC LIMIT 200",
      )
      .toArray();
  }

  async docInsert(id: string, title: string, shareId: string, now: string): Promise<void> {
    this.sql.exec(
      "INSERT INTO docs (id, title, snippet, share_id, share_access, created_at, updated_at) VALUES (?, ?, '', ?, 'none', ?, ?)",
      id, title, shareId, now, now,
    );
  }

  /** Upsert from a Doc's persist cycle — the index self-heals. */
  async docSync(
    id: string,
    fields: { title: string; snippet: string; shareId: string; shareAccess: ShareAccess; createdAt: string; updatedAt: string },
  ): Promise<void> {
    this.sql.exec(
      `INSERT INTO docs (id, title, snippet, share_id, share_access, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, snippet = excluded.snippet,
         share_access = excluded.share_access, updated_at = excluded.updated_at`,
      id, fields.title, fields.snippet, fields.shareId, fields.shareAccess, fields.createdAt, fields.updatedAt,
    );
  }

  async docDelete(id: string): Promise<void> {
    this.sql.exec("DELETE FROM docs WHERE id = ?", id);
  }

  async docByShareId(shareId: string): Promise<Pick<DocIndexRow, "id" | "share_id" | "share_access"> | null> {
    const row = this.sql
      .exec<Pick<DocIndexRow, "id" | "share_id" | "share_access">>(
        "SELECT id, share_id, share_access FROM docs WHERE share_id = ?",
        shareId,
      )
      .toArray()[0];
    return row ?? null;
  }
}

/** The one Registry instance (idFromName is deterministic). */
export function registryStub(env: Env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
}
