# MeetingWords — design

Where people and agents meet in a document. Real-time collaborative markdown with comment threads, share links, and a first-class agent API — built Cloudflare-native and serverless.

Inspired by [jot](https://github.com/badlogic/jot) and the concurrent-agent-edits work in Pete's fork; fresh code (jot carries no license), same published ideas: Matt Weidner's ["text without CRDTs"](https://mattweidner.com/2025/05/21/text-without-crdts.html) semantic-rebasing architecture over the MIT-licensed [`articulated`](https://www.npmjs.com/package/articulated) id-list library.

## Architecture

```
Browser / agent
   │  HTTPS + WebSocket
   ▼
Worker (Hono router)          — auth, share resolution, static assets
   │  stub.fetch() / RPC
   ├─▼
   │ Doc DO (one per doc)       — authoritative collab state, WebSocket
   │    │                         fan-out, comments, agent edits,
   │    │                         debounced persistence
   │    └─ DO storage (SQLite)  — markdown + collab state + threads
   └─▼
     Registry DO (singleton)       — docs index (list/search), owner auth,
        └─ DO SQLite               agent keys; upserted by Docs
```

- **One Durable Object per document.** The DO is the single authority: it holds the document's `CollabState` in memory while awake, applies client mutations in arrival order, and fans out deltas to every connected WebSocket. This is the same "one authoritative copy, sockets fan in" shape jot proved out — but sharded per document, so ten editors on each of a hundred documents costs the same per document as one.
- **WebSocket Hibernation API.** Idle connections don't keep the DO (or billing) alive; server ping/pong is handled by `setWebSocketAutoResponse`. Connection metadata survives hibernation via `serializeAttachment`.
- **Isomorphic collab core.** `src/collab/core.ts` is a pure-function module over `articulated`'s `IdList` — used verbatim by the DO *and* bundled (esbuild) into the browser client. One implementation of mutation semantics; server and clients can't drift.
- **A singleton Registry DO** (native SQLite storage) holds the cross-document index (id, title, snippet, share settings, timestamps) that per-document sharding would otherwise lose, plus auth (password record, device tokens, API keys). Each Doc upserts its index row on persist, so the index self-heals. No D1 or other hosted service: everything runs inside the Workers runtime, which is what lets the same codebase self-host on bare `workerd`/miniflare (Mac, Linux, Windows) with state as local SQLite files.
- **Static assets** via Workers Assets; markdown rendering server-side (`marked` + `sanitize-html` + `highlight.js`) at `/api/render`.

## Collaboration model (Weidner semantic rebasing)

Not a CRDT. Characters get stable element ids (`articulated` `ElementId`s). Clients send *semantic mutations* — `insert{before, id, content}` / `delete{startId, endId}` — the server applies them literally in arrival order and rebroadcasts; clients apply remote mutations to their own id-list mirror and rebase pending local ops (id-anchored positions survive concurrent edits). Periodic full-state **checkpoints** (throttled by mutation count and time) heal any drift. Persistence is debounced (~250 ms / N mutations) with a flush before hibernation and on last-client-disconnect.

## Agents are participants, not integrations

- API keys carry a **label** (the agent's name). Agent edits are attributed and broadcast under that name, live, like any collaborator's.
- `POST /api/docs/:id/edit` — batched `{oldText, newText}` edits, optionally id-anchored (`anchor: {startId, endId}`) so an agent can hold a stable reference to a span across concurrent human edits. Conflicts (anchor deleted, span changed, stale base) return structured 409s; the batch is atomic.
- `GET /api/docs/:id/changes?since=<counter>` — poll deltas without holding a socket; built for agent loops.
- Read endpoint supports `offset`/`limit` line windows for context-budgeted agent reads.

## Auth model

Single-owner, like jot: one password (PBKDF2-SHA256 via WebCrypto, 100k iterations — the Workers edge cap), device tokens (high-entropy random, stored SHA-256-hashed), API keys likewise. Share links per document with access levels `none | view | comment | edit`; commenters on shared docs get cookie identities.

Owner lifecycle around that one password:

- `POST /api/auth/password` — owner-authenticated rotation (`{currentPassword, newPassword}`); every other device is signed out, the calling session survives.
- **Setup token** — `SETUP_TOKEN` (env) or a one-time token stored by the fleet reset (below) makes `POST /api/auth/setup` require `setupToken`, closing the "first visitor claims an unconfigured instance" race. The login page picks the token up from `/login?setup=…`. Unset, setup behaves as before (fine for personal deploys claimed promptly).
- **Fleet reset hook** — `POST /api/fleet/reset-owner`, which exists only when the `FLEET_ADMIN_KEY` secret is set (404 otherwise; self-hosters opt in by setting it, and never need to). Bearer-authenticated with that key, it clears the owner password, revokes all device tokens, and returns a fresh one-time setup token — documents and agent keys untouched. This is how a hosting operator restores a locked-out customer *without* holding any standing credential to the instance's contents.

## Innovations over jot (beyond "it's serverless")

1. Per-document sharding via DOs — the scale ceiling moves from "one process" to "one document".
2. Isomorphic collab core — one mutation-semantics implementation for server and client.
3. Hibernation-native realtime — idle sockets cost ~nothing.
4. Agent-visible presence and attribution; `changes?since=` polling for socketless agents.
5. Live **roster**: the doc shows who’s present — humans and agents — as first-class participants.

## Repo layout

```
wrangler.jsonc          — Worker + DO + assets config
src/
  worker.ts             — Hono app, routes, auth middleware
  doc.ts                — the Doc Durable Object
  registry.ts           — singleton Registry DO (docs index, auth, keys; SQLite)
  collab/core.ts        — isomorphic collab core (pure functions)
  render.ts             — markdown rendering
  agent-guide.ts        — the /llms.txt self-description
  auth.ts               — password/token/key crypto (WebCrypto)
public/                 — client (app shell, editor, share view)
  (esbuild bundles: collab-client.js from client/collab-client.ts,
   editor-cm.js — CodeMirror 6 editor + remote carets — from client/editor-cm.ts;
   vendor/mermaid.min.js copied at build)
test/                   — vitest unit tests for the collab core + edit resolution
```
