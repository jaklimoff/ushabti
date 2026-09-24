"use client";

import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import {
  insertMention,
  mentionAt,
  mentionOpensUp,
  mentionRoom,
  mentionsFor,
  type Edges,
  type Mention,
} from "@/lib/mention";
import { Avatar } from "@/components/ui/Avatar";
import { useNow } from "@/components/ui/useElapsed";
import { useBoard } from "./store";
import styles from "./board.module.css";

/**
 * The list of names an `@` opens, and the keys that work it.
 *
 * Five boxes ask for it — a task at the top of a column, a task at the end of
 * a list, and the title, the description and the comment of the panel — so
 * the rules live here once. `src/lib/mention.ts` decides what the `@` means
 * and where it fits; this decides what the screen does with the answer.
 *
 * The list sits beside the box and not at the caret. A caret in a textarea
 * has no place on the screen: finding one needs a mirror of the whole box or
 * a package, and a completion is not worth either.
 */
export type MentionPicker = {
  /** Drawn only while there is somebody to name. No match, no list. */
  open: boolean;
  found: Mention[];
  /** The row the arrow keys are on. It is not focus: the box keeps that. */
  at: number;
  /** Which side of the box it opens on, measured when it opened. */
  up: boolean;
  /** How tall it may be on that side. Past it the rows scroll. */
  room: number;
  /** Reads the box again. What it holds now says whether the list is open. */
  sync: () => void;
  close: () => void;
  /** True when the key belonged to the list, so the box leaves it alone. */
  onKeyDown: (event: KeyboardEvent) => boolean;
  pick: (mention: Mention) => void;
};

/** The open list: the letters it answers, and where it was put. */
type Word = { query: string; up: boolean; room: number };

/**
 * The part of the screen the list must stay inside.
 *
 * Everything that scrolls cuts off what hangs out of it, and this list lives
 * inside two such boxes: the body of the panel and the body of a column. So
 * the room is the screen narrowed by every ancestor that clips, and the list
 * is placed and sized against that rather than against the window.
 */
function roomAround(el: HTMLElement): Edges {
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const flow = getComputedStyle(node).overflowY;
    if (flow === "visible" || flow === "clip") continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}

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
  const [word, setWord] = useState<Word | null>(null);
  const [at, setAt] = useState(0);
  const query = word ? word.query : null;

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
    setWord(null);
  }

  /*
   * Every keystroke and every move of the caret asks the same question of the
   * box itself, so the list can never be open on a word that is not there.
   *
   * The side is worked out here as well, in the event and not in a render: a
   * box near the foot of the screen — which the comment box of a busy task
   * always is — has no room under it, and the list has to open upward. One
   * measurement per keystroke, because the box grows as you type.
   */
  function sync() {
    const el = box.current;
    const found = el ? mentionAt(el.value, el.selectionStart) : null;
    setAt(0);
    if (!el || !found) return setWord(null);
    /* What the list is measured from is the element it is placed against:
       the ancestor carrying `position: relative`, which is the anchor. */
    const anchor = (el.offsetParent as HTMLElement | null) ?? el;
    const edges = anchor.getBoundingClientRect();
    const room = roomAround(anchor);
    const rows = mentionsFor(data.members, found.query, Date.now()).length;
    const up = mentionOpensUp(edges, room, rows);
    setWord({ query: found.query, up, room: mentionRoom(edges, room, up) });
  }

  function pick(mention: Mention) {
    const el = box.current;
    if (!el) return;
    const next = insertMention(el.value, el.selectionStart, mention.member.name);
    setWord(null);
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
    /* ⌘ or Ctrl + Enter belongs to the box: it sends the note and saves the
       description. Only a plain Enter picks a name. */
    if ((event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      pick(found[highlighted]);
      return true;
    }
    return false;
  }

  return {
    open,
    found,
    at: highlighted,
    up: word?.up ?? false,
    room: word?.room ?? 0,
    sync,
    close,
    onKeyDown,
    pick,
  };
}

/**
 * The names, beside the box.
 *
 * It draws itself out of the flow, so the box it belongs to only has to be
 * the element it is measured from: the parent carries `position: relative`
 * and the list is the last thing in it.
 */
export function MentionList({ picker }: { picker: MentionPicker }) {
  if (!picker.open) return null;

  return (
    <div
      className={`${styles.mentionList} ${picker.up ? styles.mentionListUp : ""}`}
      style={{ maxHeight: picker.room }}
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
