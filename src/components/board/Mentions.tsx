"use client";

import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { insertMention, mentionAt, mentionsFor, type Mention } from "@/lib/mention";
import { Avatar } from "@/components/ui/Avatar";
import { useNow } from "@/components/ui/useElapsed";
import { useBoard } from "./store";
import styles from "./board.module.css";

/**
 * The list of names an `@` opens, and the keys that work it.
 *
 * Four boxes ask for it — a task at the top of a column, a task at the end of
 * a list, and the title, the description and the comment of the panel — so
 * the rules live here once. `src/lib/mention.ts` decides what the `@` means;
 * this decides what the screen does with the answer.
 *
 * The list sits under the box and not at the caret. A caret in a textarea has
 * no place on the screen: finding one needs a mirror of the whole box or a
 * package, and a completion is not worth either.
 */
export type MentionPicker = {
  /** Drawn only while there is somebody to name. No match, no list. */
  open: boolean;
  found: Mention[];
  /** The row the arrow keys are on. It is not focus: the box keeps that. */
  at: number;
  /** Reads the box again. What it holds now says whether the list is open. */
  sync: () => void;
  close: () => void;
  /** True when the key belonged to the list, so the box leaves it alone. */
  onKeyDown: (event: KeyboardEvent) => boolean;
  pick: (mention: Mention) => void;
};

/**
 * `write` is how this box keeps its words, and picking a name goes through
 * it. So an insertion counts as typing: the draft is kept and the blur, or
 * the closed tab, saves it like any other edit.
 */
export function useMentions(
  box: RefObject<HTMLTextAreaElement | null>,
  write: (text: string) => void,
): MentionPicker {
  const { data } = useBoard();
  const [query, setQuery] = useState<string | null>(null);
  const [at, setAt] = useState(0);

  /* The box is asked at the moment of the pick, so the answer is never one
     render old. */
  const latest = useRef(write);
  latest.current = write;

  /* Listening is a lease, so the mark can go out while the list is open. The
     clock runs only while there is a list. */
  const now = useNow(query !== null);
  const found = query === null ? [] : mentionsFor(data.members, query, now);
  const open = found.length > 0;
  const highlighted = open ? Math.min(at, found.length - 1) : 0;

  function close() {
    setQuery(null);
  }

  /* Every keystroke and every move of the caret asks the same question of the
     box itself, so the list can never be open on a word that is not there. */
  function sync() {
    const el = box.current;
    const word = el ? mentionAt(el.value, el.selectionStart) : null;
    setQuery(word ? word.query : null);
    setAt(0);
  }

  function pick(mention: Mention) {
    const el = box.current;
    if (!el) return;
    const next = insertMention(el.value, el.selectionStart, mention.member.name);
    setQuery(null);
    if (!next) return;
    /* The words are React's and the caret is the browser's. The render that
       takes the words moves the caret to the end, so it is put back after
       that render and not before it. */
    flushSync(() => latest.current(next.text));
    el.focus();
    el.setSelectionRange(next.caret, next.caret);
  }

  function onKeyDown(event: KeyboardEvent): boolean {
    if (!open) return false;
    if (event.key === "Escape") {
      /* The `@` stays. Escape closes the list and nothing else: the box's own
         Escape would throw away the words or cancel the task. */
      event.preventDefault();
      event.stopPropagation();
      close();
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAt((n) => (n + 1) % found.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setAt((n) => (n - 1 + found.length) % found.length);
      return true;
    }
    /* Cmd + Enter belongs to the box: it sends the note and saves the
       description. Only a plain Enter picks a name. */
    if ((event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      pick(found[highlighted]);
      return true;
    }
    return false;
  }

  return { open, found, at: highlighted, sync, close, onKeyDown, pick };
}

/**
 * The names, under the box.
 *
 * It draws itself out of the flow, so the box it belongs to only has to be
 * the element it is measured from: the parent carries `position: relative`
 * and the list is the last thing in it.
 */
export function MentionList({ picker }: { picker: MentionPicker }) {
  if (!picker.open) return null;

  return (
    <div
      className={styles.mentionList}
      role="listbox"
      aria-label="Who you can mention"
      data-testid="mention-list"
    >
      {picker.found.map((mention, i) => (
        <div
          key={mention.member.id}
          role="option"
          aria-selected={i === picker.at}
          data-testid="mention-item"
          data-name={mention.member.name}
          className={`${styles.mentionItem} ${i === picker.at ? styles.mentionItemAt : ""}`}
          /* The box keeps the focus, exactly as the search list does. */
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => picker.pick(mention)}
        >
          <Avatar
            name={mention.member.name}
            color={mention.member.color}
            size={18}
            kind={mention.member.kind}
            live={mention.listening}
          />
          <span className={styles.mentionName}>{mention.member.name}</span>
          {mention.listening && (
            <span className={styles.mentionLive} title="It hears this the moment you send it">
              listening
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
