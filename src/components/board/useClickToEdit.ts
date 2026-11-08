"use client";

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

/** What the page answers on a click, with no help from us. */
const ANSWERS_ITSELF = "a, video, audio, summary";

/* A first click on the words waits this long for a second one. Opened at
   once, the editor would take the word a double click was selecting. */
const SECOND_CLICK_MS = 300;

/**
 * The handlers for a box of rendered words that opens an editor on a click.
 * A click the page answers itself never opens it: a link, a video's
 * controls, a details summary, Enter on any of them, or the end of a drag or
 * a double click that selected words to copy. The rule sits on the box, not
 * on the words inside it: a drag that ends in the padding, or past the box,
 * sends its click to the box and never passes through the words.
 */
export function useClickToEdit(edit: () => void, of: string) {
  const before = useRef("");
  const mouse = useRef(false);
  /* The wait belongs to the click that started it, on this task. A press
     elsewhere or another task in the panel means the person moved on, and
     the editor must not open on them later. */
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), [of]);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    mouse.current = e.pointerType === "mouse";
    before.current = selectedTouching(e.currentTarget);
  };
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const box = e.currentTarget;
    if (answeredHere(e.target as Element, box, before.current)) return;
    stop.current();
    if (e.detail > 1) return;
    /* Only a mouse double clicks to select. A finger must open the editor
       inside its own tap, or a phone shows no keyboard. A click on the
       padding selects no word, so it opens at once too. */
    if (!mouse.current || e.target === box) {
      edit();
      return;
    }
    const was = before.current;
    const elsewhere = (press: Event) => {
      if (!box.contains(press.target as Node)) stop.current();
    };
    const timer = setTimeout(() => {
      stop.current();
      if (!box.isConnected || selectedWords(box, was)) return;
      edit();
    }, SECOND_CLICK_MS);
    document.addEventListener("pointerdown", elsewhere, true);
    stop.current = () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", elsewhere, true);
      stop.current = () => {};
    };
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Enter on a link or a summary clicks it; only Enter on the box edits.
    if (e.key === "Enter" && e.target === e.currentTarget) edit();
  };
  return { onPointerDown, onClick, onKeyDown };
}

/** The words selected, when the selection touches `box` at all: a drag that
    starts in the words and runs past them still selected them. */
function selectedTouching(box: Element): string {
  const sel = typeof window === "undefined" ? null : window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return "";
  if (!sel.getRangeAt(0).intersectsNode(box)) return "";
  return sel.toString();
}

/** Whether words were selected since the press. A click on words that were
    already selected is a plain click: Chrome keeps the selection through it. */
function selectedWords(box: Element, before: string): boolean {
  const now = selectedTouching(box);
  return now.trim() !== "" && now !== before;
}

function answeredHere(target: Element, box: Element, before: string): boolean {
  if (target.closest?.(ANSWERS_ITSELF)) return true;
  return selectedWords(box, before);
}
