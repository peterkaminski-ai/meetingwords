import type { ElementId } from "articulated";
import { applyMutations, idAtIndex, newBunchId, type CollabState } from "./core";
import type { AppliedOp, ClientMutation } from "./types";

// ---------------------------------------------------------------------------
// Agent edit resolution: turn a batch of edits into semantic mutations
// against live collaborative state. Three shapes: {oldText, newText}
// replaces a unique or anchored span; {oldText: "", newText} seeds an empty
// document; {append} adds to the end regardless of content.
//
// Agents are collaborators without cursors. When an agent read the document,
// it may have captured id anchors for the spans it cares about; an anchored
// edit survives concurrent edits elsewhere and pinpoints a genuine overlap as
// a conflict instead of silently mis-applying. An unanchored edit falls back
// to unique-substring matching, guarded by an optional baseCounter staleness
// check.
//
// The batch is atomic: any conflict or error applies nothing, returning
// enough structure for the agent to re-read and retry precisely.
// ---------------------------------------------------------------------------

export type TextEdit = {
  oldText?: string;
  newText?: string;
  anchor?: { startId: ElementId; endId: ElementId };
  /** Append to the end of the document — the only shape that never needs an anchor. */
  append?: string;
};

export type EditConflict = {
  index: number;
  reason: "anchor-deleted" | "anchor-collapsed" | "span-changed" | "stale-base";
  oldText: string;
  /** What that span holds now, when it can still be read. */
  current: string | null;
};

export type EditOutcome =
  | { ok: true; state: CollabState; applied: AppliedOp[]; lastCounter: number }
  | { ok: false; status: 400 | 409; errors?: string[]; conflicts?: EditConflict[] };

export function resolveTextEdits(
  state: CollabState,
  edits: TextEdit[],
  baseCounter: number | null,
): EditOutcome {
  const counterAtStart = state.serverCounter;
  let working = state;
  let clientCounter = 0;
  const errors: string[] = [];
  const conflicts: EditConflict[] = [];
  const applied: AppliedOp[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const oldText = String(edit?.oldText ?? "");
    const newText = String(edit?.newText ?? "");

    // Shape 3: {append} — add to the end, whatever the document holds.
    if (edit?.append !== undefined) {
      if (edit.oldText !== undefined || edit.newText !== undefined || edit.anchor) {
        errors.push(`edit ${i}: append cannot be combined with oldText/newText/anchor`);
        continue;
      }
      const appendText = String(edit.append);
      if (!appendText) {
        errors.push(`edit ${i}: append must be non-empty`);
        continue;
      }
      const len = working.text.length;
      const result = applyMutations(working, [
        {
          name: "insert",
          clientCounter: ++clientCounter,
          args: {
            before: len > 0 ? idAtIndex(working, len - 1) : null,
            id: { bunchId: newBunchId(), counter: 0 },
            content: appendText,
          },
        },
      ]);
      working = result.state;
      applied.push(...result.applied);
      continue;
    }

    // Shape 2: empty oldText seeds an empty document — and only an empty one,
    // so a mistyped anchor can never silently prepend to real content.
    if (!oldText) {
      if (working.text.length > 0) {
        errors.push(`edit ${i}: oldText may be empty only when the document is empty — use {append} or anchor on existing text`);
        continue;
      }
      if (!newText) {
        errors.push(`edit ${i}: newText must be non-empty when seeding an empty document`);
        continue;
      }
      const result = applyMutations(working, [
        {
          name: "insert",
          clientCounter: ++clientCounter,
          args: { before: null, id: { bunchId: newBunchId(), counter: 0 }, content: newText },
        },
      ]);
      working = result.state;
      applied.push(...result.applied);
      continue;
    }

    let start: number;
    let end: number;

    if (edit.anchor?.startId && edit.anchor?.endId) {
      const { startId, endId } = edit.anchor;
      if (!working.idList.isKnown(startId) || !working.idList.isKnown(endId)) {
        errors.push(`edit ${i}: anchor ids were never part of this document`);
        continue;
      }
      if (!working.idList.has(startId) || !working.idList.has(endId)) {
        conflicts.push({ index: i, reason: "anchor-deleted", oldText, current: null });
        continue;
      }
      start = working.idList.indexOf(startId);
      end = working.idList.indexOf(endId);
      if (end < start) {
        conflicts.push({ index: i, reason: "anchor-collapsed", oldText, current: null });
        continue;
      }
      const currentSpan = working.text.slice(start, end + 1);
      if (currentSpan !== oldText) {
        conflicts.push({ index: i, reason: "span-changed", oldText, current: currentSpan });
        continue;
      }
    } else {
      if (baseCounter !== null && baseCounter < counterAtStart) {
        conflicts.push({ index: i, reason: "stale-base", oldText, current: null });
        continue;
      }
      const first = working.text.indexOf(oldText);
      if (first === -1) {
        errors.push(`edit ${i}: oldText not found`);
        continue;
      }
      if (working.text.indexOf(oldText, first + 1) !== -1) {
        errors.push(`edit ${i}: oldText is ambiguous — appears more than once; anchor it or widen it`);
        continue;
      }
      start = first;
      end = first + oldText.length - 1;
    }

    const mutations: ClientMutation[] = [
      {
        name: "delete",
        clientCounter: ++clientCounter,
        args: { startId: idAtIndex(working, start), endId: idAtIndex(working, end) },
      },
    ];
    if (newText.length > 0) {
      mutations.push({
        name: "insert",
        clientCounter: ++clientCounter,
        args: {
          before: start > 0 ? idAtIndex(working, start - 1) : null,
          id: { bunchId: newBunchId(), counter: 0 },
          content: newText,
        },
      });
    }

    const result = applyMutations(working, mutations);
    working = result.state;
    applied.push(...result.applied);
  }

  if (conflicts.length > 0) {
    return { ok: false, status: 409, conflicts, errors: errors.length ? errors : undefined };
  }
  if (errors.length > 0) {
    return { ok: false, status: 400, errors };
  }

  return { ok: true, state: working, applied, lastCounter: clientCounter };
}
