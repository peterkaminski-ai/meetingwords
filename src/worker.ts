import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { AGENT_GUIDE } from "./agent-guide";
import { hashPassword, randomToken, sha256Hex, shortId, verifyPassword } from "./auth";
import {
  LOGIN_THROTTLE_KEY,
  SETUP_TOKEN_EXPIRES_KEY,
  lockRemaining,
  parseThrottle,
  recordFailure,
  serializeThrottle,
  setupTokenExpiry,
  setupTokenFresh,
} from "./auth-throttle";
import { instanceInfo, normalizeLang } from "./instance";
import { registryStub } from "./registry";
import { renderMarkdown } from "./render";
import { H_ACCESS, H_AGENT, H_GUEST_ID, H_GUEST_NAME, H_ROLE, type Env } from "./env";
import type { ShareAccess } from "./collab/types";

export { Doc } from "./doc";
export { Registry } from "./registry";

// ---------------------------------------------------------------------------
// The Worker: authentication, the cross-document index (Registry DO),
// share-link resolution, markdown rendering, static assets — and a thin proxy
// that forwards document operations to the right Doc DO with the
// caller's verified role in trusted headers.
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "mw_session";
const GUEST_ID_COOKIE = "mw_guest_id";
const GUEST_NAME_COOKIE = "mw_guest_name";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const GUEST_MAX_AGE = 60 * 60 * 24 * 365;

type Vars = {
  agentLabel: string | null;
};

type AppEnv = { Bindings: Env; Variables: Vars };
type Ctx = Context<AppEnv>;

const app = new Hono<AppEnv>();

// Every response advertises the agent API, so an agent that has only fetched a
// URL — even with HEAD — already knows there's a programmatic path and where the
// manual is. Without this, discovering the API is a matter of whether the agent
// happens to go looking: browser automation against the editor DOM "works" well
// enough that nothing ever prompts the search, and an agent driving the live
// editor races human collaborators with no conflict detection. Relative URLs so
// self-hosted instances point at their own guide.
const AGENT_LINK = '</llms.txt>; rel="service-doc"; type="text/markdown", </api>; rel="service-desc"';

app.use("*", async (c, next) => {
  await next();
  // 101 responses are WebSocket upgrades — they can't be rebuilt, and an agent
  // reaching one has already found the API anyway.
  if (c.res.status === 101 || c.res.headers.has("link")) return;
  // Asset responses arrive with immutable headers; rebuild to stamp them.
  const stamped = new Response(c.res.body, c.res);
  stamped.headers.set("link", AGENT_LINK);
  c.res = stamped;
});

// -- helpers ------------------------------------------------------------------

function docStub(c: Ctx, docId: string) {
  const id = c.env.DOC.idFromName(docId);
  return c.env.DOC.get(id);
}

function bearerToken(c: Ctx): string | null {
  const header = c.req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  return null;
}

async function authConfigured(env: Env): Promise<boolean> {
  return (await registryStub(env).settingsGet("password")) !== null;
}

/** Whether /api/auth/setup demands a setup token (env, or one stored by a fleet reset). */
async function setupTokenRequired(env: Env): Promise<boolean> {
  if (env.SETUP_TOKEN) return true;
  return (await registryStub(env).settingsGet("setup_token_hash")) !== null;
}

async function verifySetupToken(env: Env, given: string): Promise<boolean> {
  if (!given) return false;
  if (env.SETUP_TOKEN && (await sha256Hex(given)) === (await sha256Hex(env.SETUP_TOKEN))) return true;
  const registry = registryStub(env);
  const storedHash = await registry.settingsGet("setup_token_hash");
  if (storedHash === null || (await sha256Hex(given)) !== storedHash) return false;
  // Fleet-issued tokens travel in URLs, so they expire (fail closed when stale).
  return setupTokenFresh(await registry.settingsGet(SETUP_TOKEN_EXPIRES_KEY), new Date());
}

/**
 * Gate around password verification: 429 while locked, one failure recorded
 * per wrong password, counter cleared on success. Runs before the PBKDF2
 * work so a locked-out guesser costs nothing.
 */
async function checkPasswordThrottle(c: Ctx): Promise<Response | null> {
  const throttle = parseThrottle(await registryStub(c.env).settingsGet(LOGIN_THROTTLE_KEY));
  const wait = lockRemaining(throttle, new Date());
  if (wait === 0) return null;
  c.header("Retry-After", String(wait));
  return c.json({ ok: false, error: `Too many attempts. Try again in ${wait} seconds.` }, 429);
}

async function recordPasswordFailure(c: Ctx): Promise<void> {
  const registry = registryStub(c.env);
  const throttle = parseThrottle(await registry.settingsGet(LOGIN_THROTTLE_KEY));
  await registry.settingsPut(LOGIN_THROTTLE_KEY, serializeThrottle(recordFailure(throttle, new Date())));
}

async function clearPasswordThrottle(c: Ctx): Promise<void> {
  await registryStub(c.env).settingsDelete(LOGIN_THROTTLE_KEY);
}

async function verifyDeviceToken(env: Env, token: string): Promise<boolean> {
  const hash = await sha256Hex(token);
  return registryStub(env).tokenVerify(hash, new Date().toISOString());
}

async function verifyApiKey(env: Env, key: string): Promise<string | null> {
  const hash = await sha256Hex(key);
  return registryStub(env).keyVerify(hash);
}

/** Owner if session cookie or Bearer device token verifies. */
async function isOwner(c: Ctx): Promise<boolean> {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie && (await verifyDeviceToken(c.env, cookie))) return true;
  const bearer = bearerToken(c);
  if (bearer && (await verifyDeviceToken(c.env, bearer))) return true;
  return false;
}

async function issueDeviceToken(env: Env): Promise<string> {
  const token = randomToken();
  await registryStub(env).tokenInsert(shortId(8), await sha256Hex(token), new Date().toISOString());
  return token;
}

function setSessionCookie(c: Ctx, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Owner session or API key. Sets agentLabel when the caller is an agent key. */
async function requireOwnerApi(c: Ctx): Promise<Response | null> {
  c.set("agentLabel", null);
  if (await isOwner(c)) return null;
  const bearer = bearerToken(c);
  if (bearer) {
    const label = await verifyApiKey(c.env, bearer);
    if (label !== null) {
      c.set("agentLabel", label);
      return null;
    }
  }
  return c.json({ ok: false, error: "Not authorized.", hint: "GET /llms.txt for API usage." }, 401);
}

type ShareRow = { id: string; share_id: string; share_access: ShareAccess };

const ACCESS_RANK: Record<ShareAccess, number> = { none: 0, view: 1, comment: 2, edit: 3 };

async function resolveShare(
  c: Ctx,
  shareId: string,
  need: ShareAccess,
): Promise<ShareRow | Response> {
  const row = await registryStub(c.env).docByShareId(shareId);
  if (!row || row.share_access === "none") return c.json({ ok: false, error: "Not found." }, 404);
  if (ACCESS_RANK[row.share_access] < ACCESS_RANK[need]) {
    return c.json({ ok: false, error: "Not allowed." }, 403);
  }
  return row;
}

/** Forward a request to a DO with the caller's verified role attached. */
async function forwardToDoc(
  c: Ctx,
  docId: string,
  path: string,
  init: {
    method?: string;
    body?: BodyInit | null;
    role: "owner" | "guest";
    access: "owner" | ShareAccess;
  },
): Promise<Response> {
  const headers = new Headers();
  headers.set(H_ROLE, init.role);
  headers.set(H_ACCESS, init.access);
  const agentLabel = c.get("agentLabel");
  if (agentLabel) headers.set(H_AGENT, encodeURIComponent(agentLabel));
  const guestId = getCookie(c, GUEST_ID_COOKIE);
  if (guestId) headers.set(H_GUEST_ID, guestId);
  const guestName = getCookie(c, GUEST_NAME_COOKIE);
  if (guestName) headers.set(H_GUEST_NAME, encodeURIComponent(guestName));
  if (init.body) headers.set("content-type", "application/json");

  const stub = docStub(c, docId);
  return stub.fetch(`https://do${path}`, {
    method: init.method || "GET",
    headers,
    body: init.body ?? undefined,
  });
}

function asset(c: Ctx, path: string): Promise<Response> {
  const url = new URL(c.req.url);
  url.pathname = path;
  return c.env.ASSETS.fetch(new Request(url.toString(), { headers: c.req.raw.headers }));
}

// -- health + pages -----------------------------------------------------------

app.get("/health", (c) => c.text("ok"));

// The instance is its own manual: the agent API guide, served from the deployment.
app.get("/llms.txt", (c) => c.text(AGENT_GUIDE));
app.get("/api", (c) => c.body(AGENT_GUIDE, 200, { "content-type": "text/markdown; charset=utf-8" }));

app.get("/", async (c) => {
  if (!(await isOwner(c))) return c.redirect("/login");
  return asset(c, "/index.html");
});

app.get("/login", async (c) => {
  if (await isOwner(c)) return c.redirect("/");
  // Setup links carry a token in the query string; never leak it via Referer.
  const original = await asset(c, "/login.html");
  const page = new Response(original.body, original);
  page.headers.set("Referrer-Policy", "no-referrer");
  return page;
});

app.get("/d/:id", async (c) => {
  if (!(await isOwner(c))) return c.redirect("/login");
  return asset(c, "/editor.html");
});

// An agent that only wants to *read* the pad should never have to open a browser
// to do it. `?format=md`, or an Accept header that asks for markdown without also
// asking for HTML, returns the document itself instead of the SPA shell — and the
// response carries the counter to pass back as `baseCounter` when editing.
function wantsMarkdown(c: Ctx): boolean {
  const fmt = (c.req.query("format") || "").toLowerCase();
  if (fmt) return fmt === "md" || fmt === "markdown";
  const accept = (c.req.header("accept") || "").toLowerCase();
  if (!accept.includes("text/markdown")) return false;
  return !accept.includes("text/html");
}

app.get("/s/:shareId", async (c) => {
  if (!wantsMarkdown(c)) return asset(c, "/share.html");
  const share = await resolveShare(c, c.req.param("shareId"), "view");
  if (share instanceof Response) return share;
  const state = await forwardToDoc(c, share.id, "/state", { role: "guest", access: share.share_access });
  if (!state.ok) return state;
  const data = (await state.json()) as { doc: { title: string; markdown: string; serverCounter: number } };
  return c.body(data.doc.markdown, 200, {
    "content-type": "text/markdown; charset=utf-8",
    "x-mw-doc-title": encodeURIComponent(data.doc.title ?? ""),
    "x-mw-server-counter": String(data.doc.serverCounter ?? 0),
  });
});

// -- auth ----------------------------------------------------------------------

app.get("/api/viewer", async (c) => {
  const configured = await authConfigured(c.env);
  return c.json({
    ok: true,
    authConfigured: configured,
    ownerAuthenticated: await isOwner(c),
    guestName: getCookie(c, GUEST_NAME_COOKIE) || null,
    instance: instanceInfo(c.env, normalizeLang(c.req.query("lang"))),
    setupTokenRequired: configured ? false : await setupTokenRequired(c.env),
  });
});

app.post("/api/auth/setup", async (c) => {
  if (await authConfigured(c.env)) return c.json({ ok: false, error: "Passphrase already configured." }, 400);
  const body = await c.req.json<{ password?: string; confirmPassword?: string; setupToken?: string }>();
  if ((await setupTokenRequired(c.env)) && !(await verifySetupToken(c.env, String(body.setupToken || "")))) {
    return c.json({ ok: false, error: "Setup token required.", hint: "This instance was provisioned with a setup token; use the setup link you were given." }, 403);
  }
  const password = String(body.password || "");
  if (password.length < 8) return c.json({ ok: false, error: "Use at least 8 characters." }, 400);
  if (password !== String(body.confirmPassword || "")) {
    return c.json({ ok: false, error: "Passphrases do not match." }, 400);
  }
  await registryStub(c.env).settingsPut("password", await hashPassword(password));
  await registryStub(c.env).settingsDelete("setup_token_hash");
  await registryStub(c.env).settingsDelete(SETUP_TOKEN_EXPIRES_KEY);
  const token = await issueDeviceToken(c.env);
  setSessionCookie(c, token);
  return c.json({ ok: true, token });
});

app.post("/api/auth/login", async (c) => {
  const locked = await checkPasswordThrottle(c);
  if (locked) return locked;
  const stored = await registryStub(c.env).settingsGet("password");
  if (!stored) return c.json({ ok: false, error: "Passphrase is not configured yet." }, 400);
  const body = await c.req.json<{ password?: string }>();
  if (!(await verifyPassword(String(body.password || ""), stored))) {
    await recordPasswordFailure(c);
    return c.json({ ok: false, error: "Wrong passphrase." }, 401);
  }
  await clearPasswordThrottle(c);
  const token = await issueDeviceToken(c.env);
  setSessionCookie(c, token);
  return c.json({ ok: true, token });
});

/** Owner password rotation. Signs out every other device; this session survives. */
app.post("/api/auth/password", async (c) => {
  if (!(await isOwner(c))) return c.json({ ok: false, error: "Not authorized." }, 401);
  // Same throttle as login: a stolen session must not be able to brute-force
  // the current password out of this endpoint.
  const locked = await checkPasswordThrottle(c);
  if (locked) return locked;
  const stored = await registryStub(c.env).settingsGet("password");
  if (!stored) return c.json({ ok: false, error: "Passphrase is not configured yet." }, 400);
  const body = await c.req.json<{ currentPassword?: string; newPassword?: string }>();
  if (!(await verifyPassword(String(body.currentPassword || ""), stored))) {
    await recordPasswordFailure(c);
    return c.json({ ok: false, error: "Wrong passphrase." }, 401);
  }
  await clearPasswordThrottle(c);
  const newPassword = String(body.newPassword || "");
  if (newPassword.length < 8) return c.json({ ok: false, error: "Use at least 8 characters." }, 400);
  await registryStub(c.env).settingsPut("password", await hashPassword(newPassword));
  const current = getCookie(c, SESSION_COOKIE) || bearerToken(c);
  if (current) await registryStub(c.env).tokenDeleteAllExcept(await sha256Hex(current));
  return c.json({ ok: true });
});

/** Re-establish the cookie from a localStorage token (new browser context). */
app.post("/api/auth/token", async (c) => {
  const body = await c.req.json<{ token?: string }>();
  const token = String(body.token || "");
  if (!token || !(await verifyDeviceToken(c.env, token))) {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: false }, 401);
  }
  setSessionCookie(c, token);
  return c.json({ ok: true });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await registryStub(c.env).tokenDelete(await sha256Hex(token));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// -- fleet admin ------------------------------------------------------------------
//
// Exists only when the FLEET_ADMIN_KEY secret is set at deploy time (404
// otherwise) — hosting operators opt in; self-hosters never need to. The hook
// deliberately cannot read or write documents: it resets the owner credential
// and nothing else, so the operator holds no standing key to the instance's
// contents. See DESIGN.md "Auth model".

app.post("/api/fleet/reset-owner", async (c) => {
  const fleetKey = c.env.FLEET_ADMIN_KEY;
  if (!fleetKey) return c.json({ ok: false, error: "Not found.", hint: "GET /api or /llms.txt for API usage." }, 404);
  const bearer = bearerToken(c);
  if (!bearer || (await sha256Hex(bearer)) !== (await sha256Hex(fleetKey))) {
    return c.json({ ok: false, error: "Not authorized." }, 401);
  }
  const registry = registryStub(c.env);
  await registry.settingsDelete("password");
  await registry.tokenDeleteAll();
  await registry.settingsDelete(LOGIN_THROTTLE_KEY);
  const setupToken = randomToken();
  const expires = setupTokenExpiry(new Date());
  await registry.settingsPut("setup_token_hash", await sha256Hex(setupToken));
  await registry.settingsPut(SETUP_TOKEN_EXPIRES_KEY, expires);
  return c.json({ ok: true, setupToken, setupPath: `/login?setup=${setupToken}`, expires });
});

// -- API keys (agents) ----------------------------------------------------------

app.get("/api/keys", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  return c.json({ ok: true, keys: await registryStub(c.env).keyList() });
});

app.post("/api/keys", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  const body = await c.req.json<{ label?: string }>();
  const label = String(body.label || "unnamed").slice(0, 80);
  const key = `mw_${randomToken()}`;
  const id = shortId(8);
  await registryStub(c.env).keyInsert(id, label, await sha256Hex(key), new Date().toISOString());
  return c.json({ ok: true, id, label, key });
});

app.delete("/api/keys/:id", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  const deleted = await registryStub(c.env).keyDelete(c.req.param("id"));
  if (!deleted) return c.json({ ok: false, error: "API key not found." }, 404);
  return c.json({ ok: true });
});

// -- documents (owner + agents) ---------------------------------------------------

app.get("/api/docs", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  const q = String(c.req.query("q") || "").trim();
  return c.json({ ok: true, docs: await registryStub(c.env).docsList(q) });
});

app.post("/api/docs", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  const body = await c.req.json<{ title?: string; markdown?: string }>().catch(() => ({}) as Record<string, string>);
  const id = shortId(10);
  const shareId = shortId(14);
  const now = new Date().toISOString();
  const title = String(body.title || "untitled").slice(0, 200);
  await registryStub(c.env).docInsert(id, title, shareId, now);
  const response = await forwardToDoc(c, id, "/init", {
    method: "POST",
    body: JSON.stringify({ id, shareId, title, markdown: String(body.markdown || "") }),
    role: "owner",
    access: "owner",
  });
  if (!response.ok) return response;
  return c.json({ ok: true, doc: { id, title, shareId, shareAccess: "none", updatedAt: now } });
});

app.get("/api/docs/:id", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  const id = c.req.param("id");
  const offset = c.req.query("offset");
  const limit = c.req.query("limit");
  const anchors = c.req.query("anchors");
  if (offset || limit || anchors) {
    const qs = new URLSearchParams();
    if (offset) qs.set("offset", offset);
    if (limit) qs.set("limit", limit);
    if (anchors) qs.set("anchors", anchors);
    return forwardToDoc(c, id, `/read?${qs}`, { role: "owner", access: "owner" });
  }
  return forwardToDoc(c, id, "/state", { role: "owner", access: "owner" });
});

app.put("/api/docs/:id", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  return forwardToDoc(c, c.req.param("id"), "/doc", {
    method: "PUT",
    body: await c.req.text(),
    role: "owner",
    access: "owner",
  });
});

app.delete("/api/docs/:id", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  const id = c.req.param("id");
  const response = await forwardToDoc(c, id, "/doc", { method: "DELETE", role: "owner", access: "owner" });
  if (response.ok) {
    await registryStub(c.env).docDelete(id);
  }
  return response;
});

app.post("/api/docs/:id/edit", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  return forwardToDoc(c, c.req.param("id"), "/edit", {
    method: "POST",
    body: await c.req.text(),
    role: "owner",
    access: "owner",
  });
});

app.get("/api/docs/:id/changes", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  const since = String(c.req.query("since") || "0");
  return forwardToDoc(c, c.req.param("id"), `/changes?since=${encodeURIComponent(since)}`, {
    role: "owner",
    access: "owner",
  });
});

app.get("/api/docs/:id/rendered", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  const state = await forwardToDoc(c, c.req.param("id"), "/state", { role: "owner", access: "owner" });
  if (!state.ok) return state;
  const data = (await state.json()) as { doc: { markdown: string } };
  return c.json({ ok: true, html: renderMarkdown(data.doc.markdown) });
});

app.post("/api/render", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  const body = await c.req.json<{ markdown?: string }>();
  return c.json({ ok: true, html: renderMarkdown(String(body.markdown || "")) });
});

// Comment threads (owner/agent surface).
app.post("/api/docs/:id/threads", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  return forwardToDoc(c, c.req.param("id"), "/threads", {
    method: "POST",
    body: await c.req.text(),
    role: "owner",
    access: "owner",
  });
});

app.post("/api/docs/:id/threads/:threadId/replies", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  return forwardToDoc(c, c.req.param("id"), `/threads/${c.req.param("threadId")}/replies`, {
    method: "POST",
    body: await c.req.text(),
    role: "owner",
    access: "owner",
  });
});

app.on(["PATCH", "DELETE"], "/api/docs/:id/threads/:threadId", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  return forwardToDoc(c, c.req.param("id"), `/threads/${c.req.param("threadId")}`, {
    method: c.req.method,
    body: c.req.method === "PATCH" ? await c.req.text() : null,
    role: "owner",
    access: "owner",
  });
});

app.on(["PATCH", "DELETE"], "/api/docs/:id/messages/:messageId", async (c) => {
  const denied = await requireOwnerApi(c);
  if (denied) return denied;
  return forwardToDoc(c, c.req.param("id"), `/messages/${c.req.param("messageId")}`, {
    method: c.req.method,
    body: c.req.method === "PATCH" ? await c.req.text() : null,
    role: "owner",
    access: "owner",
  });
});

// -- shared documents (guests) ------------------------------------------------------

app.get("/api/share/:shareId", async (c) => {
  const share = await resolveShare(c, c.req.param("shareId"), "view");
  if (share instanceof Response) return share;
  return forwardToDoc(c, share.id, "/state", { role: "guest", access: share.share_access });
});

app.get("/api/share/:shareId/rendered", async (c) => {
  const share = await resolveShare(c, c.req.param("shareId"), "view");
  if (share instanceof Response) return share;
  const state = await forwardToDoc(c, share.id, "/state", { role: "guest", access: share.share_access });
  if (!state.ok) return state;
  const data = (await state.json()) as { doc: { markdown: string } };
  return c.json({ ok: true, html: renderMarkdown(data.doc.markdown) });
});

app.get("/api/share/:shareId/changes", async (c) => {
  const share = await resolveShare(c, c.req.param("shareId"), "view");
  if (share instanceof Response) return share;
  const since = String(c.req.query("since") || "0");
  return forwardToDoc(c, share.id, `/changes?since=${encodeURIComponent(since)}`, {
    role: "guest",
    access: share.share_access,
  });
});

app.post("/api/share/:shareId/edit", async (c) => {
  const share = await resolveShare(c, c.req.param("shareId"), "edit");
  if (share instanceof Response) return share;
  return forwardToDoc(c, share.id, "/edit", {
    method: "POST",
    body: await c.req.text(),
    role: "guest",
    access: share.share_access,
  });
});

app.post("/api/share/:shareId/identity", async (c) => {
  const share = await resolveShare(c, c.req.param("shareId"), "comment");
  if (share instanceof Response) return share;
  const body = await c.req.json<{ name?: string }>();
  const name = String(body.name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (!name) return c.json({ ok: false, error: "Name is required." }, 400);
  const secure = new URL(c.req.url).protocol === "https:";
  if (!getCookie(c, GUEST_ID_COOKIE)) {
    setCookie(c, GUEST_ID_COOKIE, shortId(16), {
      httpOnly: true,
      sameSite: "Lax",
      secure,
      path: "/",
      maxAge: GUEST_MAX_AGE,
    });
  }
  setCookie(c, GUEST_NAME_COOKIE, name, { sameSite: "Lax", secure, path: "/", maxAge: GUEST_MAX_AGE });
  return c.json({ ok: true, guestName: name });
});

app.post("/api/share/:shareId/threads", async (c) => {
  const share = await resolveShare(c, c.req.param("shareId"), "comment");
  if (share instanceof Response) return share;
  return forwardToDoc(c, share.id, "/threads", {
    method: "POST",
    body: await c.req.text(),
    role: "guest",
    access: share.share_access,
  });
});

app.post("/api/share/:shareId/threads/:threadId/replies", async (c) => {
  const share = await resolveShare(c, c.req.param("shareId"), "comment");
  if (share instanceof Response) return share;
  return forwardToDoc(c, share.id, `/threads/${c.req.param("threadId")}/replies`, {
    method: "POST",
    body: await c.req.text(),
    role: "guest",
    access: share.share_access,
  });
});

app.on(["PATCH", "DELETE"], "/api/share/:shareId/threads/:threadId", async (c) => {
  const share = await resolveShare(c, c.req.param("shareId"), "comment");
  if (share instanceof Response) return share;
  return forwardToDoc(c, share.id, `/threads/${c.req.param("threadId")}`, {
    method: c.req.method,
    body: c.req.method === "PATCH" ? await c.req.text() : null,
    role: "guest",
    access: share.share_access,
  });
});

app.on(["PATCH", "DELETE"], "/api/share/:shareId/messages/:messageId", async (c) => {
  const share = await resolveShare(c, c.req.param("shareId"), "comment");
  if (share instanceof Response) return share;
  return forwardToDoc(c, share.id, `/messages/${c.req.param("messageId")}`, {
    method: c.req.method,
    body: c.req.method === "PATCH" ? await c.req.text() : null,
    role: "guest",
    access: share.share_access,
  });
});

// -- realtime ---------------------------------------------------------------------

app.get("/ws", async (c) => {
  if (c.req.header("upgrade") !== "websocket") {
    return c.json({ ok: false, error: "Expected WebSocket upgrade." }, 426);
  }

  const docId = c.req.query("docId");
  const shareId = c.req.query("shareId");

  let targetDocId: string;
  let role: "owner" | "guest";
  let access: "owner" | ShareAccess;

  if (docId) {
    if (!(await isOwner(c))) return c.json({ ok: false, error: "Not authorized." }, 401);
    targetDocId = docId;
    role = "owner";
    access = "owner";
  } else if (shareId) {
    const share = await resolveShare(c, shareId, "view");
    if (share instanceof Response) return share;
    targetDocId = share.id;
    role = "guest";
    access = share.share_access;
  } else {
    return c.json({ ok: false, error: "docId or shareId required." }, 400);
  }

  const headers = new Headers(c.req.raw.headers);
  headers.set(H_ROLE, role);
  headers.set(H_ACCESS, access);
  const guestId = getCookie(c, GUEST_ID_COOKIE);
  if (guestId) headers.set(H_GUEST_ID, guestId);
  const guestName = getCookie(c, GUEST_NAME_COOKIE);
  if (guestName) headers.set(H_GUEST_NAME, encodeURIComponent(guestName));

  const stub = docStub(c, targetDocId);
  return stub.fetch("https://do/ws", { method: "GET", headers });
});

// -- fallthrough -----------------------------------------------------------------

// Unknown API routes answer in JSON with a pointer at the guide, not asset 404s.
app.all("/api/*", (c) =>
  c.json({ ok: false, error: "Not found.", hint: "GET /api or /llms.txt for API usage." }, 404),
);

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
