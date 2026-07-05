# MeetingWords FAQ

## Isn't "text without CRDTs" just a CRDT at a higher semantic level?

No — it's nearly the opposite, and the distinction is precise.

The defining property of a CRDT is *convergence without coordination*: concurrent operations must commute (or states must merge as a join-semilattice), so replicas can apply them in any order and converge with no authority choosing an order. That requirement is exactly what Matt Weidner's ["text without CRDTs"](https://mattweidner.com/2025/05/21/text-without-crdts.html) architecture deliberately drops. There *is* an authority — the server; in MeetingWords, each document's Durable Object — and it applies mutations literally, in arrival order. The operations don't commute: as the [`articulated`](https://www.npmjs.com/package/articulated) README notes, concurrent `insertAfter` on the same anchor id resolves by whichever arrived first. Clients don't merge; they *rebase* — roll back to the server's confirmed sequence, replay their unacknowledged local edits on top.

What the approach borrows from CRDT research is the **identifier technology**: stable per-character element ids with tombstones, an idea from list CRDTs (RGA, Fugue, and kin). Stable ids are what keep intent meaningful across concurrency — "insert after character X" stays correct no matter what happened elsewhere in the document. But the concurrency-resolution mathematics is replaced by the oldest pattern in multiplayer games: authoritative server, client-side prediction, rollback-and-replay ("server reconciliation").

So the honest genealogy: **CRDT ids + game-networking reconciliation − CRDT merge semantics.**

The trade, and why MeetingWords wants this side of it:

- **Given up:** offline-first and peer-to-peer merging. Every edit path goes through the document's one authority. (That authority being a Durable Object — tiny, per-document, hibernating — is what makes this cheap.)
- **Gained:** a much simpler correctness story (one order, chosen once), and the ability to surface conflicts *semantically*. A pure CRDT never says "conflict" — it always merges, occasionally into nonsense, because the data structure can't know what anyone meant. An authoritative server can instead reply, in application terms: "the span you anchored was edited (`span-changed`), here's what it says now, re-read and retry." For human+agent co-editing — MeetingWords' whole point — a structured 409 an agent can act on beats a silent merge it can't see.

Footnote for symmetry: `articulated`'s README notes you *can* build a true CRDT on top of `IdList` by supplying an eventually-consistent total order. The id-list is CRDT-adjacent infrastructure; the architectural choice of *who supplies the order* — a server, or the math — is what separates the two designs.
