// WebSocket collaboration smoke test: drives two real CollabSession clients.
// Usage: start `npm run dev`, enable edit-sharing on a doc, then:
//   node test/ws-smoke.mjs <shareId> <ownerToken> <docId> [port]
// (the exact browser bundle) against a running wrangler dev instance.
import { CollabSession } from "../public/collab-client.js";

const [shareId, ownerToken, docId, port = "8787"] = process.argv.slice(2);
const url = `ws://localhost:${port}/ws?shareId=${shareId}`;

function waitFor(cond, ms = 8000, label = "condition") {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > ms) return reject(new Error(`timeout waiting for ${label}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

function makeSession(name) {
  const events = [];
  const session = new CollabSession(url, {
    onText: () => {},
    onStatus: (s) => events.push(`${name}:${s}`),
    onPresence: (p) => events.push(`${name}:presence:${p.kind}:${p.name}`),
    onRoster: (r) => events.push(`${name}:roster:${r.length}`),
  });
  session.connect();
  return { session, events };
}

const a = makeSession("A");
const b = makeSession("B");
await waitFor(() => a.session.ready && b.session.ready, 8000, "both sessions ready");
console.log("1. both connected; base text:", JSON.stringify(a.session.text.slice(0, 30)));

// Concurrent edits from both ends.
a.session.localEdit(0, 0, "AAA ");
b.session.localEdit(b.session.text.length, 0, "\nZZZ");
await waitFor(
  () => a.session.text === b.session.text && a.session.text.startsWith("AAA ") && a.session.text.endsWith("ZZZ"),
  8000,
  "simple convergence",
);
console.log("2. concurrent edits converged");

// Interleaved burst: A types forward while B prepends — worst-case interleaving.
for (let i = 0; i < 25; i++) {
  a.session.localEdit(4 + i, 0, String(i % 10));
  b.session.localEdit(0, 0, "b");
}
await waitFor(() => a.session.text === b.session.text, 8000, "burst convergence");
const burstText = a.session.text;
if (!burstText.includes("0123456789012345678901234")) {
  throw new Error("A's typed run was scrambled: " + JSON.stringify(burstText.slice(0, 80)));
}
if (!burstText.startsWith("b".repeat(25))) {
  throw new Error("B's prepend run was scrambled: " + JSON.stringify(burstText.slice(0, 40)));
}
console.log("3. 50-op interleaved burst converged, both intents intact");

// Deletion overlapping a concurrent insert.
const beforeDel = a.session.text;
const zzzAt = beforeDel.indexOf("\nZZZ");
a.session.localEdit(zzzAt, 4, "");
b.session.localEdit(b.session.text.length, 0, "!");
await waitFor(() => a.session.text === b.session.text, 8000, "delete/insert convergence");
console.log("4. concurrent delete+insert converged");

// Agent REST edit lands in both live sessions, attributed.
const marker = "AGENT_WAS_HERE";
const res = await fetch(`http://localhost:${port}/api/docs/${docId}/edit`, {
  method: "POST",
  headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
  body: JSON.stringify({ edits: [{ oldText: "AAA", newText: marker }] }),
});
if (!res.ok) throw new Error("agent edit failed: " + (await res.text()));
await waitFor(
  () => a.session.text.includes(marker) && b.session.text.includes(marker) && a.session.text === b.session.text,
  8000,
  "REST edit propagation",
);
console.log("5. REST agent edit propagated live to both sessions");

console.log("\nfinal text:", JSON.stringify(a.session.text));
console.log("events sample:", a.events.slice(0, 6).join(" | "));
a.session.close();
b.session.close();
console.log("\nWS SMOKE: ALL PASS");
process.exit(0);
