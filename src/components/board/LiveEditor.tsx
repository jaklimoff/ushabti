"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as hint } from "@codemirror/view";
import { livePreview } from "@/lib/live-markdown";
import type { TextBox } from "./Mentions";

/**
 * The CodeMirror box, behind the same few things a textarea gives
 * `MarkdownBox`: the words, the caret, focus. So the `@` list and the upload
 * work it without knowing which box they hold.
 */
export type LiveEditorProps = {
  value: string;
  onChange: (text: string) => void;
  /** The caret moved or the words changed: the `@` list reads the box again. */
  onSelect: () => void;
  /** True when the key was used, so CodeMirror leaves it alone. */
  onKeyDown: (event: KeyboardEvent) => boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onFiles: (files: File[]) => void;
  boxRef: RefObject<TextBox | null>;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
};

export default function LiveEditor(props: LiveEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /* CodeMirror keeps its handlers for its whole life, so they ask for the
     props of the latest render. */
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const p = latest.current;
    let gone = false;
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: p.value,
        extensions: [
          history(),
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (e) => latest.current.onKeyDown(e) || e.defaultPrevented,
              drop: (e) => take(e.dataTransfer?.files, e),
              paste: (e) => take(e.clipboardData?.files, e),
              focus: () => latest.current.onFocus?.(),
              /* A box taken off the screen sends no blur, as a textarea does
                 not: Escape unmounts the box and must save nothing. */
              blur: () => {
                if (!gone) latest.current.onBlur?.();
              },
            }),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Description",
            "data-testid": "live-editor",
          }),
          p.placeholder ? hint(p.placeholder) : [],
          livePreview(),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) latest.current.onSelect();
          }),
        ],
      }),
    });
    function take(list: FileList | undefined, e: Event) {
      const files = list ? [...list] : [];
      if (files.length === 0) return false;
      e.preventDefault();
      latest.current.onFiles(files);
      return true;
    }
    view.current = v;
    const box: TextBox = {
      get value() {
        return v.state.doc.toString();
      },
      get selectionStart() {
        return v.state.selection.main.head;
      },
      get offsetParent() {
        return v.dom.offsetParent;
      },
      focus: () => v.focus(),
      setSelectionRange: (from, to) => v.dispatch({ selection: { anchor: from, head: to } }),
      owns: (el) => !!el && v.dom.contains(el),
    };
    latest.current.boxRef.current = box;
    if (p.autoFocus) {
      v.focus();
      v.dispatch({ selection: { anchor: v.state.doc.length } });
    }
    return () => {
      gone = true;
      v.destroy();
      view.current = null;
    };
  }, []);

  /* Words from outside — a picked name, an upload line — are put in before the
     caller moves the caret, so this runs in the layout pass. Only the part that
     differs is replaced, so a caret before it stays where it was. */
  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    const now = v.state.doc.toString();
    if (now === props.value) return;
    let start = 0;
    while (start < now.length && now[start] === props.value[start]) start++;
    let end = 0;
    while (
      end < now.length - start &&
      end < props.value.length - start &&
      now[now.length - 1 - end] === props.value[props.value.length - 1 - end]
    )
      end++;
    v.dispatch({
      changes: {
        from: start,
        to: now.length - end,
        insert: props.value.slice(start, props.value.length - end),
      },
    });
  }, [props.value]);

  return <div ref={host} className={props.className} />;
}
