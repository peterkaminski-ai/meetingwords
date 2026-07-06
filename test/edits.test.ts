import { describe, expect, it } from "vitest";
import { applyMutations, collabFromText, idAtIndex } from "../src/collab/core";
import { resolveTextEdits } from "../src/collab/edits";
import type { ClientMutation } from "../src/collab/types";

describe("agent text edits", () => {
  it("applies a simple unique replacement", () => {
    const state = collabFromText("The quick brown fox.");
    const result = resolveTextEdits(state, [{ oldText: "brown", newText: "red" }], null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.text).toBe("The quick red fox.");
      expect(result.applied.length).toBe(2); // delete + insert
    }
  });

  it("applies multiple edits sequentially, later edits seeing earlier results", () => {
    const state = collabFromText("aaa bbb ccc");
    const result = resolveTextEdits(
      state,
      [
        { oldText: "aaa", newText: "xxx" },
        { oldText: "xxx bbb", newText: "yyy" },
      ],
      null,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.text).toBe("yyy ccc");
  });

  it("supports pure deletion (empty newText)", () => {
    const state = collabFromText("keep remove keep2");
    const result = resolveTextEdits(state, [{ oldText: " remove", newText: "" }], null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.text).toBe("keep keep2");
  });

  it("rejects ambiguous unanchored edits", () => {
    const state = collabFromText("dup text dup");
    const result = resolveTextEdits(state, [{ oldText: "dup", newText: "x" }], null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.errors?.[0]).toMatch(/ambiguous/);
    }
  });

  it("flags stale-base when the doc advanced past the agent's read", () => {
    const state = collabFromText("hello", 5);
    const result = resolveTextEdits(state, [{ oldText: "hello", newText: "hi" }], 3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.conflicts?.[0].reason).toBe("stale-base");
    }
  });

  it("anchored edits survive concurrent edits elsewhere", () => {
    // Agent read the doc and anchored "brown". A human then prepends text.
    const base = collabFromText("The quick brown fox.");
    const anchor = { startId: idAtIndex(base, 10), endId: idAtIndex(base, 14) };

    const humanInsert: ClientMutation = {
      name: "insert",
      clientCounter: 1,
      args: { before: null, id: { bunchId: crypto.randomUUID(), counter: 0 }, content: "NOTE: " },
    };
    const drifted = applyMutations(base, [humanInsert]).state;
    expect(drifted.text).toBe("NOTE: The quick brown fox.");

    // baseCounter is stale, but the anchor makes the edit precise anyway.
    const result = resolveTextEdits(
      drifted,
      [{ oldText: "brown", newText: "red", anchor }],
      base.serverCounter,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.text).toBe("NOTE: The quick red fox.");
  });

  it("reports span-changed when the anchored text was edited", () => {
    const base = collabFromText("The quick brown fox.");
    const anchor = { startId: idAtIndex(base, 10), endId: idAtIndex(base, 14) };

    // Human replaces "row" inside "brown" before the agent's edit arrives.
    const inner = resolveTextEdits(base, [{ oldText: "row", newText: "ROW" }], null);
    expect(inner.ok).toBe(true);
    const drifted = inner.ok ? inner.state : base;

    const result = resolveTextEdits(drifted, [{ oldText: "brown", newText: "red", anchor }], null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflicts?.[0].reason).toBe("span-changed");
      expect(result.conflicts?.[0].current).toBe("bROWn");
    }
  });

  it("reports anchor-deleted when the anchored span was removed", () => {
    const base = collabFromText("delete me entirely");
    const anchor = { startId: idAtIndex(base, 7), endId: idAtIndex(base, 8) }; // "me"
    const wiped = resolveTextEdits(base, [{ oldText: "delete me", newText: "gone" }], null);
    expect(wiped.ok).toBe(true);
    const drifted = wiped.ok ? wiped.state : base;

    const result = resolveTextEdits(drifted, [{ oldText: "me", newText: "us", anchor }], null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts?.[0].reason).toBe("anchor-deleted");
  });

  it("is atomic: one conflict applies nothing", () => {
    const state = collabFromText("alpha beta gamma");
    const result = resolveTextEdits(
      state,
      [
        { oldText: "alpha", newText: "A" },
        { oldText: "missing", newText: "x" },
      ],
      null,
    );
    expect(result.ok).toBe(false);
    // Original state untouched (pure functions — caller keeps old state).
    expect(state.text).toBe("alpha beta gamma");
  });
});

describe("seeding and appending (the empty-document fixes, 2026-07-05)", () => {
  it("seeds an empty document with an empty oldText", () => {
    const state = collabFromText("");
    const result = resolveTextEdits(state, [{ oldText: "", newText: "# Hello\n" }], null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.text).toBe("# Hello\n");
  });

  it("rejects an empty oldText when the document has content", () => {
    const state = collabFromText("already here");
    const result = resolveTextEdits(state, [{ oldText: "", newText: "clobber" }], null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.[0]).toMatch(/only when the document is empty/);
  });

  it("rejects seeding with an empty newText", () => {
    const state = collabFromText("");
    const result = resolveTextEdits(state, [{ oldText: "", newText: "" }], null);
    expect(result.ok).toBe(false);
  });

  it("appends to a non-empty document", () => {
    const state = collabFromText("line one\n");
    const result = resolveTextEdits(state, [{ append: "line two\n" }], null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.text).toBe("line one\nline two\n");
  });

  it("appends to an empty document", () => {
    const state = collabFromText("");
    const result = resolveTextEdits(state, [{ append: "first\n" }], null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.text).toBe("first\n");
  });

  it("rejects append combined with oldText", () => {
    const state = collabFromText("abc");
    const result = resolveTextEdits(state, [{ append: "x", oldText: "abc", newText: "y" }], null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors?.[0]).toMatch(/cannot be combined/);
  });

  it("rejects an empty append", () => {
    const state = collabFromText("abc");
    const result = resolveTextEdits(state, [{ append: "" }], null);
    expect(result.ok).toBe(false);
  });

  it("mixes append with replacements in one atomic batch", () => {
    const state = collabFromText("alpha beta");
    const result = resolveTextEdits(
      state,
      [
        { oldText: "alpha", newText: "A" },
        { append: " gamma" },
      ],
      null,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.text).toBe("A beta gamma");
  });
});
