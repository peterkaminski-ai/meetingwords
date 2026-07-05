import { IdList, type ElementId, type SavedIdList } from "articulated";
import type { AppliedOp, ClientMutation, DeleteArgs, InsertArgs } from "./types";

// ---------------------------------------------------------------------------
// Isomorphic collab core: pure functions over articulated's persistent IdList.
// This exact module runs in the Doc Durable Object AND in the
// browser bundle, so server and clients share one implementation of mutation
// semantics and cannot drift.
//
// Invariant: state.text[i] is the character whose id is state.idList.at(i).
// Deleted ids remain "known" (tombstones), which is what lets concurrent
// mutations that reference them still resolve to the right position.
// ---------------------------------------------------------------------------

export type CollabState = {
  idList: IdList;
  text: string;
  serverCounter: number;
};

export type SavedCollabState = {
  idList: SavedIdList;
  text: string;
  serverCounter: number;
};

export function newCollabState(): CollabState {
  return { idList: IdList.new(), text: "", serverCounter: 0 };
}

/** Build fresh state from plain text (new doc, import, or full overwrite). */
export function collabFromText(text: string, serverCounter = 0): CollabState {
  let idList = IdList.new();
  if (text.length > 0) {
    idList = idList.insertAfter(null, { bunchId: newBunchId(), counter: 0 }, text.length);
  }
  return { idList, text, serverCounter };
}

export function saveCollabState(state: CollabState): SavedCollabState {
  return { idList: state.idList.save(), text: state.text, serverCounter: state.serverCounter };
}

export function loadCollabState(saved: SavedCollabState): CollabState {
  return { idList: IdList.load(saved.idList), text: saved.text, serverCounter: saved.serverCounter };
}

export type ApplyResult = {
  state: CollabState;
  /** Ops actually applied, in order — broadcast these. Empty if all were no-ops. */
  applied: AppliedOp[];
  changed: boolean;
};

/**
 * Apply mutations literally, in order. Throws if a mutation references an id
 * this state has never seen (a protocol violation or badly drifted client —
 * callers catch and resync the sender with a hello).
 *
 * Duplicate inserts (already-known id) and fully-deleted delete ranges are
 * no-ops, which makes redelivery after reconnect safe.
 */
export function applyMutations(state: CollabState, mutations: ClientMutation[] | AppliedOp[]): ApplyResult {
  let { idList, text, serverCounter } = state;
  const applied: AppliedOp[] = [];

  for (const mutation of mutations) {
    if (mutation.name === "insert") {
      const args = mutation.args as InsertArgs;
      if (args.content.length === 0) continue;
      if (idList.isKnown(args.id)) continue; // duplicate delivery
      if (args.before !== null && !idList.isKnown(args.before)) {
        throw new Error("insert.before references an unknown id");
      }
      idList = idList.insertAfter(args.before, args.id, args.content.length);
      const at = idList.indexOf(args.id);
      text = text.slice(0, at) + args.content + text.slice(at);
      applied.push({ name: "insert", args });
      serverCounter++;
      continue;
    }

    const args = mutation.args as DeleteArgs;
    if (!idList.isKnown(args.startId) || !idList.isKnown(args.endId)) {
      throw new Error("delete references an unknown id");
    }
    const from = idList.has(args.startId)
      ? idList.indexOf(args.startId)
      : idList.indexOf(args.startId, "right");
    const to = idList.has(args.endId)
      ? idList.indexOf(args.endId)
      : idList.indexOf(args.endId, "left");
    if (to < from) continue; // range already fully deleted
    idList = idList.deleteRange(from, to + 1);
    text = text.slice(0, from) + text.slice(to + 1);
    applied.push({ name: "delete", args });
    serverCounter++;
  }

  return {
    state: { idList, text, serverCounter },
    applied,
    changed: applied.length > 0,
  };
}

/** Id of the character currently at `index`. */
export function idAtIndex(state: CollabState, index: number): ElementId {
  return state.idList.at(index);
}

/** Cursor (gap position) for `index`, stable across concurrent edits. */
export function cursorAtIndex(state: CollabState, index: number): ElementId | null {
  return state.idList.cursorAt(index);
}

/** Current index of a cursor captured earlier. */
export function indexOfCursor(state: CollabState, cursor: ElementId | null): number {
  return state.idList.cursorIndex(cursor);
}

export function newBunchId(): string {
  return crypto.randomUUID();
}

export type LineAnchor = {
  /** 1-based line number. */
  line: number;
  /** Ids of the line's first/last character; null for empty lines. */
  startId: ElementId | null;
  endId: ElementId | null;
};

/**
 * Stable id endpoints for each line in a 1-based line window. Agents capture
 * these to anchor edits (`anchor: {startId, endId}`) that survive concurrent
 * edits elsewhere in the document. Empty lines carry no characters, so their
 * anchors are null — anchor to a neighboring line instead.
 */
export function lineAnchors(state: CollabState, offset: number, count: number): LineAnchor[] {
  const lines = state.text.split("\n");
  const first = Math.max(0, offset - 1);
  const last = Math.min(lines.length, first + count);
  let charIndex = 0;
  for (let i = 0; i < first; i++) charIndex += lines[i].length + 1;

  const anchors: LineAnchor[] = [];
  for (let i = first; i < last; i++) {
    const length = lines[i].length;
    anchors.push({
      line: i + 1,
      startId: length > 0 ? state.idList.at(charIndex) : null,
      endId: length > 0 ? state.idList.at(charIndex + length - 1) : null,
    });
    charIndex += length + 1;
  }
  return anchors;
}
