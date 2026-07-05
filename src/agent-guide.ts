// The agent-facing API guide, served from the deployment itself at
// GET /llms.txt and GET /api — so a deployment is its own manual: hand an agent
// a URL and a key and it can bootstrap everything else from here.
// Keep this in sync when routes change; it is the only API doc an instance
// carries.

export const AGENT_GUIDE = `# MeetingWords — agent API guide

Where people and agents meet in a document: real-time collaborative
markdown. Agents are participants, not integrations — your edits broadcast
live, attributed to your API key's label, alongside human cursors.

Base URL: this host. All endpoints return JSON unless noted.
This guide: GET /llms.txt (also GET /api).

## Auth

Send \`Authorization: Bearer mw_...\` — an API key the owner creates in the UI
(its label is your display name). Guests with a share link use the /api/share
endpoints instead; no key needed.

## Documents

- \`GET /api/docs\` — list all. \`?q=term\` searches title + snippet.
- \`POST /api/docs\` — create. Body \`{"title": "...", "markdown": "..."}\`.
- \`GET /api/docs/:id\` — full state: markdown, serverCounter, share info, comment threads.
- \`GET /api/docs/:id?offset=1&limit=40\` — line-window read (1-based; response
  carries totalLines and remaining — budget-friendly). Add \`&anchors=1\` to get
  per-line \`{startId, endId}\` element ids (null on empty lines) for anchored edits.
- \`PUT /api/docs/:id\` — any of \`{"title": ...}\`, \`{"markdown": ...}\` (full
  overwrite — prefer /edit), \`{"shareAccess": "none|view|comment|edit"}\`.
- \`DELETE /api/docs/:id\`
- \`GET /api/docs/:id/rendered\` — sanitized HTML.

## Editing (the intended agent path)

POST /api/docs/:id/edit

    {"edits": [{"oldText": "speling", "newText": "spelling"}], "baseCounter": 41}

- Each oldText must match the document exactly once; the batch is atomic
  (all edits apply or none).
- Pass \`baseCounter\` from a read's serverCounter: if the document moved on,
  unanchored edits fail 409 \`stale-base\` instead of hitting drifted text.
  Re-read, re-derive, retry.
- Anchored edit: \`{"oldText", "newText", "anchor": {"startId", "endId"}}\`
  pins the match to that span (ids from \`?anchors=1\`). It survives concurrent
  edits elsewhere in the document, failing only on genuine overlap: 409 with
  reason \`span-changed\` (current text of the span is included),
  \`anchor-deleted\`, or \`anchor-collapsed\`.
- Failures are structured: \`{ok: false, errors?: [...], conflicts?: [{index,
  reason, oldText, current}], serverCounter}\` — act on them programmatically.

## Staying current without a socket

\`GET /api/docs/:id/changes?since=<counter>\` — the applied ops since that
counter, or \`resync: {text, idList}\` if you are too far behind. Poll in a
loop; serverCounter in every response tells you where you are.

## Comments

- \`POST /api/docs/:id/threads\` — \`{"quote": "exact text to anchor on", "body": "..."}\`.
- \`POST /api/docs/:id/threads/:tid/replies\` — \`{"body": "..."}\`.
- \`PATCH /api/docs/:id/threads/:tid\` — \`{"resolved": true|false}\`.

## Share-link access (no API key)

Guests hold \`/s/:shareId\` links. The same shapes live under
\`/api/share/:shareId\`: GET (state), GET /rendered, GET /changes?since=,
POST /edit (edit-level links), POST /threads and replies (comment-level).
Set your name first: \`POST /api/share/:shareId/identity\` \`{"name": "..."}\`
(cookie identity; send the cookie on subsequent requests).

## Realtime (optional)

\`GET /ws?docId=\` (owner/key auth) or \`GET /ws?shareId=\` upgrades to a
WebSocket carrying hello / mutation / checkpoint / presence / roster
messages. Most agents don't need it — the edit + changes endpoints are the
intended agent loop.
`;
