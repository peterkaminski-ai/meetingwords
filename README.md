# MeetingWords

**Where people and agents meet in a document.** Real-time collaborative markdown with comment threads, share links, and a first-class agent API — fully serverless on Cloudflare (Workers + Durable Objects), with no services beyond the runtime, so the same codebase also self-hosts on any machine that runs `workerd`.

The name revives [MeetingWords](https://meetingwords.com), the free public collaborative editor that ran 2010–2024 — rebuilt from scratch for the era when your collaborators include agents.

Inspired by [jot](https://github.com/badlogic/jot) and the concurrent-agent-edits work in [Pete's fork](https://github.com/peterkaminski/jot-concurrent-agent-edits); fresh code on the same published ideas — Matt Weidner's ["text without CRDTs"](https://mattweidner.com/2025/05/21/text-without-crdts.html) architecture over the MIT-licensed [`articulated`](https://www.npmjs.com/package/articulated) library. See [DESIGN.md](DESIGN.md) for architecture and [FAQ.md](FAQ.md) for the "isn't this just a CRDT?" question.

## What it does

- **Live collaborative editing** — every keystroke syncs through the document's Durable Object; concurrent edits from any number of participants converge, with intent preserved (id-anchored positions, rollback/replay optimism, checkpoint healing).
- **Agents are participants, not integrations** — API keys carry the agent's name; agent edits broadcast live under that name; `{oldText, newText}` edit batches resolve against live state with structured conflicts (`span-changed`, `anchor-deleted`, `stale-base`) instead of blind overwrites; `changes?since=` lets socketless agents catch up.
- **Comment threads** anchored to text, from owners, guests, and agents alike.
- **Share links** per document: `view` (live-updating rendered page), `comment`, or `edit` (full collaborative editor for guests).
- **Live roster** — who's in the doc right now, humans and agents both.
- **Per-document scaling** — each document is its own Durable Object; idle documents hibernate to near-zero cost.

## Develop locally

```bash
npm install
npm run dev          # builds the client bundle, starts wrangler dev
```

Visit http://localhost:8787, set the owner password on first load. All state (documents, index, auth) lives in SQLite files under `.wrangler/state/` — nothing touches the cloud. Add `-- --ip 0.0.0.0` to reach it from other devices on your network.

Tests (collab core + agent edit resolution):

```bash
npm test
```

## Deploy

```bash
npm run deploy
```

That's the whole procedure — no databases to create or migrate; the Registry Durable Object owns all cross-document state in its own SQLite storage. Open the deployed URL and set the owner password. (First visitor sets it — deploy and claim promptly, or add Cloudflare Access in front.)

## Agent API

**A deployed instance documents itself**: `GET /llms.txt` (or `GET /api`) serves the full agent guide from the deployment, and API 401/404 responses carry a hint pointing there — hand an agent a URL and a key and it can bootstrap the rest. The summary below matches that guide.

Create a key in the UI (**Agent keys** — the label is the agent's display name), then:

```bash
AUTH="Authorization: Bearer mw_..."

# List / search documents
curl -H "$AUTH" "https://mw.example.com/api/docs?q=roadmap"

# Read with a line window (agent-budget friendly; note serverCounter for later)
curl -H "$AUTH" "https://mw.example.com/api/docs/DOC_ID?offset=1&limit=40"

# Read with per-line id anchors: each line's {startId, endId} for anchored edits
# (empty lines anchor null — use a neighboring line)
curl -H "$AUTH" "https://mw.example.com/api/docs/DOC_ID?offset=1&limit=40&anchors=1"

# Edit: batch of {oldText, newText}; atomic; unique-match or 400/409 with structure
curl -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"edits":[{"oldText":"speling","newText":"spelling"}],"baseCounter":41}' \
  "https://mw.example.com/api/docs/DOC_ID/edit"

# Poll changes since a counter (ops, or a resync snapshot if too far behind)
curl -H "$AUTH" "https://mw.example.com/api/docs/DOC_ID/changes?since=41"

# Comment on a quote
curl -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"quote":"the passage in question","body":"Suggest tightening this."}' \
  "https://mw.example.com/api/docs/DOC_ID/threads"

# Create a document
curl -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"title":"Meeting notes","markdown":"# Agenda\n"}' \
  "https://mw.example.com/api/docs"
```

Conflict semantics: pass `baseCounter` (from a read) and unanchored edits are rejected with `stale-base` if the document moved on; or anchor an edit to element ids — captured wholesale via `?anchors=1` on a read, or from `GET /api/docs/:id`'s saved id list — as `anchor: {startId, endId}`, and it survives concurrent edits elsewhere, failing loudly only on genuine overlap.

Guests with an `edit` share link get the same edit API without an account: `POST /api/share/SHARE_ID/edit`.

## What the editor gives you

- **CodeMirror 6** with markdown syntax highlighting; undo/redo tracks only your own edits — remote collaborators' changes are never in your history.
- **In-text remote carets**: each participant's cursor and selection, colored and name-flagged, live in the text (plus the roster's line numbers).
- **Mermaid** diagrams render client-side in preview and shared views (lazy-loaded, theme-aware).
- Light/dark theme following your OS preference, with a manual toggle.

## Status / known limits

- Single-owner model by design (one password; guests via share links; agents via keys).

## License

MeetingWords is open source under the [Common Public Attribution License 1.0](LICENSE) (CPAL-1.0, OSI-approved) — an intentional piece of lineage: CPAL was created at [Socialtext](https://en.wikipedia.org/wiki/Socialtext), the collaborative-software company from the same chapter of life that produced the original MeetingWords service, and this revival puts the new collaborative-document tool under the license the last one wrote.

What CPAL means in practice (plain-language version at [meetingwords.org/license](https://meetingwords.org/license)):

- **Run it, modify it, self-host it — free.** Keep the one-line "Runs MeetingWords" attribution in the footer (the software renders it for you; leaving it alone is compliance).
- **Run a modified copy as a service** and you make your modifications' source available (§15 — network use counts as distribution).
- **The name is not the code.** "MeetingWords" is a trademark; deployments that aren't ours pick their own name.
- **Attribution removal or proprietary embedding**: commercial licenses available — support@meetingwords.com.

See [NOTICE](NOTICE) for the attribution and per-file coverage details.
