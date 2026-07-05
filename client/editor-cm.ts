import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  WidgetType,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { CollabSession, diffStrings, type CollabCallbacks } from "./collab-client";

// ---------------------------------------------------------------------------
// CodeMirror 6 editor bound to a CollabSession.
//
// Local edits flow CM -> session.localEdit (which broadcasts mutations);
// remote text arrives as session.onText and is dispatched into CM as a
// change transaction marked remote + addToHistory:false — so undo/redo only
// ever touch the local user's own edits, the fix for textarea-collab's
// classic "undo eats someone else's typing" failure.
//
// Remote presence renders as in-text carets: a colored caret widget with a
// name flag at each participant's selection head, plus a tinted selection
// range when their anchor differs.
// ---------------------------------------------------------------------------

const remoteChange = Annotation.define<boolean>();

type RemoteCaret = {
  clientId: string;
  name: string;
  color: string;
  anchor: number;
  head: number;
};

const setCaretEffect = StateEffect.define<RemoteCaret>();
const removeCaretEffect = StateEffect.define<string>(); // clientId

class CaretWidget extends WidgetType {
  constructor(
    private color: string,
    private name: string,
  ) {
    super();
  }

  eq(other: CaretWidget) {
    return other.color === this.color && other.name === this.name;
  }

  toDOM() {
    const caret = document.createElement("span");
    caret.className = "cm-remote-caret";
    caret.style.borderLeftColor = this.color;
    const label = document.createElement("span");
    label.className = "cm-remote-caret-label";
    label.style.background = this.color;
    label.textContent = this.name;
    caret.append(label);
    return caret;
  }

  ignoreEvent() {
    return true;
  }
}

type CaretFieldValue = { carets: Map<string, RemoteCaret>; deco: DecorationSet };

function buildDecorations(carets: Map<string, RemoteCaret>, docLength: number): DecorationSet {
  const ranges = [];
  for (const caret of carets.values()) {
    const head = Math.min(caret.head, docLength);
    const anchor = Math.min(caret.anchor, docLength);
    if (anchor !== head) {
      ranges.push(
        Decoration.mark({
          class: "cm-remote-selection",
          attributes: { style: `background-color: ${caret.color}2e` },
        }).range(Math.min(anchor, head), Math.max(anchor, head)),
      );
    }
    ranges.push(Decoration.widget({ widget: new CaretWidget(caret.color, caret.name), side: -1 }).range(head));
  }
  return Decoration.set(ranges, true);
}

const remoteCaretsField = StateField.define<CaretFieldValue>({
  create: () => ({ carets: new Map(), deco: Decoration.none }),
  update(value, tr) {
    let carets = value.carets;
    let changed = false;

    if (tr.docChanged && carets.size > 0) {
      carets = new Map(
        [...carets].map(([id, caret]) => [
          id,
          { ...caret, anchor: tr.changes.mapPos(caret.anchor), head: tr.changes.mapPos(caret.head) },
        ]),
      );
      changed = true;
    }

    for (const effect of tr.effects) {
      if (effect.is(setCaretEffect)) {
        if (!changed) carets = new Map(carets);
        carets.set(effect.value.clientId, effect.value);
        changed = true;
      } else if (effect.is(removeCaretEffect)) {
        if (!carets.has(effect.value)) continue;
        if (!changed) carets = new Map(carets);
        carets.delete(effect.value);
        changed = true;
      }
    }

    if (!changed) return value;
    return { carets, deco: buildDecorations(carets, tr.newDoc.length) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
});

export type EditorHandle = {
  session: CollabSession;
  view: EditorView;
  /** Current primary selection as absolute offsets. */
  selection: () => { from: number; to: number };
  /** Select a range and scroll it into view (jump-to-quote). */
  select: (from: number, to: number) => void;
  /** Show or hide the line-number gutter. */
  setLineNumbers: (on: boolean) => void;
  destroy: () => void;
};

export function bindEditor(
  parent: HTMLElement,
  wsUrl: string,
  callbacks: Omit<CollabCallbacks, "onText"> & { onText?: (text: string) => void },
  options: { placeholder?: string; lineNumbers?: boolean } = {},
): EditorHandle {
  let view: EditorView | null = null;
  const lineNumbersCompartment = new Compartment();

  const session = new CollabSession(wsUrl, {
    ...callbacks,
    onText: (text) => {
      if (view) {
        const current = view.state.doc.toString();
        const edit = diffStrings(current, text);
        if (edit) {
          view.dispatch({
            changes: { from: edit.start, to: edit.start + edit.removed, insert: edit.inserted },
            annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
          });
        }
      }
      callbacks.onText?.(text);
    },
    onPresence: (p) => {
      if (view) {
        if (p.index === null || p.kind === "agent") {
          view.dispatch({ effects: removeCaretEffect.of(p.clientId) });
        } else {
          view.dispatch({
            effects: setCaretEffect.of({
              clientId: p.clientId,
              name: p.name,
              color: p.color,
              anchor: p.anchorIndex ?? p.index,
              head: p.index,
            }),
          });
        }
      }
      callbacks.onPresence?.(p);
    },
    onPresenceLeave: (clientId) => {
      view?.dispatch({ effects: removeCaretEffect.of(clientId) });
      callbacks.onPresenceLeave?.(clientId);
    },
  });

  let presenceTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePresence = () => {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      if (!view) return;
      const main = view.state.selection.main;
      session.sendPresence(main.anchor, main.head);
    }, 120);
  };

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      const isRemote = update.transactions.some((tr) => tr.annotation(remoteChange));
      if (!isRemote && session.ready) {
        // Feed CM's change ranges to the session. Ranges arrive in ascending
        // old-doc coordinates; localEdit applies to the session view
        // immediately, so later ranges shift by the accumulated delta.
        let delta = 0;
        update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          const text = inserted.toString();
          session.localEdit(fromA + delta, toA - fromA, text);
          delta += text.length - (toA - fromA);
        });
      }
    }
    if (update.selectionSet || update.docChanged) schedulePresence();
  });

  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        markdown(),
        syntaxHighlighting(classHighlighter),
        remoteCaretsField,
        updateListener,
        lineNumbersCompartment.of(options.lineNumbers ? lineNumbers() : []),
        placeholderExt(options.placeholder || ""),
        EditorView.contentAttributes.of({
          spellcheck: "false",
          autocorrect: "off",
          autocapitalize: "off",
        }),
      ],
    }),
  });

  session.connect();

  return {
    session,
    view,
    selection: () => {
      const main = view!.state.selection.main;
      return { from: main.from, to: main.to };
    },
    select: (from, to) => {
      const max = view!.state.doc.length;
      view!.dispatch({
        selection: { anchor: Math.min(from, max), head: Math.min(to, max) },
        scrollIntoView: true,
      });
      view!.focus();
    },
    setLineNumbers: (on) => {
      view!.dispatch({ effects: lineNumbersCompartment.reconfigure(on ? lineNumbers() : []) });
    },
    destroy: () => {
      if (presenceTimer) clearTimeout(presenceTimer);
      session.close();
      view?.destroy();
    },
  };
}
