import { describe, expect, it } from "vitest";
import {
  applyMutations,
  collabFromText,
  cursorAtIndex,
  idAtIndex,
  indexOfCursor,
  lineAnchors,
  loadCollabState,
  newCollabState,
  saveCollabState,
  type CollabState,
} from "../src/collab/core";
import type { ClientMutation } from "../src/collab/types";

function insert(state: CollabState, at: number, content: string, counter = 1) {
  const mutation: ClientMutation = {
    name: "insert",
    clientCounter: counter,
    args: {
      before: at > 0 ? idAtIndex(state, at - 1) : null,
      id: { bunchId: crypto.randomUUID(), counter: 0 },
      content,
    },
  };
  return { mutation, result: applyMutations(state, [mutation]) };
}

function del(state: CollabState, from: number, to: number, counter = 1) {
  const mutation: ClientMutation = {
    name: "delete",
    clientCounter: counter,
    args: { startId: idAtIndex(state, from), endId: idAtIndex(state, to) },
  };
  return { mutation, result: applyMutations(state, [mutation]) };
}

describe("collab core", () => {
  it("builds state from text and round-trips through save/load", () => {
    const state = collabFromText("hello doc", 7);
    expect(state.text).toBe("hello doc");
    expect(state.idList.length).toBe(9);

    const revived = loadCollabState(JSON.parse(JSON.stringify(saveCollabState(state))));
    expect(revived.text).toBe("hello doc");
    expect(revived.serverCounter).toBe(7);
    expect(revived.idList.length).toBe(9);
    // ids survive serialization
    expect(revived.idList.at(0)).toEqual(state.idList.at(0));
  });

  it("inserts at start, middle, and end", () => {
    let state = newCollabState();
    state = insert(state, 0, "world").result.state;
    expect(state.text).toBe("world");
    state = insert(state, 0, "hello ").result.state;
    expect(state.text).toBe("hello world");
    state = insert(state, 11, "!").result.state;
    expect(state.text).toBe("hello world!");
    state = insert(state, 5, ",").result.state;
    expect(state.text).toBe("hello, world!");
    expect(state.serverCounter).toBe(4);
  });

  it("deletes ranges and treats fully-deleted ranges as no-ops", () => {
    let state = collabFromText("abcdef");
    const { mutation, result } = del(state, 1, 3); // remove "bcd"
    state = result.state;
    expect(state.text).toBe("aef");
    expect(result.applied).toHaveLength(1);

    // Redelivery of the same delete: endpoints are tombstones now, no-op.
    const again = applyMutations(state, [mutation]);
    expect(again.changed).toBe(false);
    expect(again.state.text).toBe("aef");
  });

  it("is idempotent for duplicate inserts", () => {
    let state = collabFromText("ab");
    const { mutation, result } = insert(state, 1, "X");
    state = result.state;
    expect(state.text).toBe("aXb");
    const again = applyMutations(state, [mutation]);
    expect(again.changed).toBe(false);
    expect(again.state.text).toBe("aXb");
  });

  it("anchors concurrent edits by id, not index", () => {
    // Two clients both saw "shared doc". A inserts at the front; B deletes
    // "doc" by ids captured before A's insert. B's delete must still remove
    // exactly "doc" even though its indices shifted.
    const base = collabFromText("shared doc");
    const bDelete: ClientMutation = {
      name: "delete",
      clientCounter: 1,
      args: { startId: idAtIndex(base, 7), endId: idAtIndex(base, 9) },
    };

    let server = base;
    server = insert(server, 0, "our ").result.state; // A arrives first
    expect(server.text).toBe("our shared doc");
    server = applyMutations(server, [bDelete]).state; // B applied literally
    expect(server.text).toBe("our shared ");
  });

  it("resolves inserts after a tombstone to the right position", () => {
    // A inserts after "x" while B concurrently deletes "x": A's insert must
    // land where "x" used to be, via the tombstone.
    const base = collabFromText("wxyz");
    const afterX: ClientMutation = {
      name: "insert",
      clientCounter: 1,
      args: {
        before: idAtIndex(base, 1), // "x"
        id: { bunchId: crypto.randomUUID(), counter: 0 },
        content: "!",
      },
    };

    let server = base;
    server = del(server, 1, 1).result.state; // delete "x" first
    expect(server.text).toBe("wyz");
    server = applyMutations(server, [afterX]).state;
    expect(server.text).toBe("w!yz");
  });

  it("throws on mutations that reference never-known ids", () => {
    const state = collabFromText("abc");
    expect(() =>
      applyMutations(state, [
        {
          name: "insert",
          clientCounter: 1,
          args: {
            before: { bunchId: "nobody", counter: 0 },
            id: { bunchId: crypto.randomUUID(), counter: 0 },
            content: "x",
          },
        },
      ]),
    ).toThrow();
  });

  it("keeps cursors stable across concurrent edits", () => {
    let state = collabFromText("one two");
    const cursor = cursorAtIndex(state, 3); // after "one"
    state = insert(state, 0, ">> ").result.state;
    expect(indexOfCursor(state, cursor)).toBe(6);
    expect(state.text.slice(0, 6)).toBe(">> one");
  });

  it("keeps mirrors identical when the same ops are applied in the same order", () => {
    // The server-reconciliation invariant: any replica that applies the
    // broadcast ops in broadcast order is byte-identical to the server.
    let server = collabFromText("collaborate");
    const mirror0 = loadCollabState(saveCollabState(server));

    const ops: ClientMutation[] = [];
    const a = insert(server, 11, " now", 1);
    server = a.result.state;
    ops.push(a.mutation);
    const b = del(server, 0, 2, 2);
    server = b.result.state;
    ops.push(b.mutation);
    const c = insert(server, 0, "Let's ", 3);
    server = c.result.state;
    ops.push(c.mutation);

    expect(server.text).toBe("Let's laborate now");

    let mirror = mirror0;
    for (const op of ops) {
      mirror = applyMutations(mirror, [op]).state;
    }
    expect(mirror.text).toBe(server.text);
    expect(mirror.idList.save()).toEqual(server.idList.save());
  });

  it("produces line anchors that survive concurrent edits", () => {
    let state = collabFromText("alpha\n\ngamma delta\nomega");
    const anchors = lineAnchors(state, 1, 4);
    expect(anchors.map((a) => a.line)).toEqual([1, 2, 3, 4]);
    expect(anchors[1].startId).toBeNull(); // empty line
    expect(anchors[1].endId).toBeNull();

    // Anchor endpoints point at the right characters.
    expect(state.idList.indexOf(anchors[2].startId!)).toBe(7);
    expect(state.idList.indexOf(anchors[2].endId!)).toBe(17);

    // A concurrent insert above shifts indices; the anchor still finds line 3.
    state = insert(state, 0, "# title\n").result.state;
    const from = state.idList.indexOf(anchors[2].startId!);
    const to = state.idList.indexOf(anchors[2].endId!);
    expect(state.text.slice(from, to + 1)).toBe("gamma delta");
  });

  it("windows line anchors by offset and count", () => {
    const state = collabFromText("one\ntwo\nthree");
    const anchors = lineAnchors(state, 2, 5);
    expect(anchors.map((a) => a.line)).toEqual([2, 3]);
    expect(state.idList.indexOf(anchors[0].startId!)).toBe(4);
  });
});
