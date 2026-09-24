import { useEffect, useRef } from "react";

/**
 * A shortcut listening on the window must not fire while somebody is typing.
 * Escape in the task panel and `/` in the search box both ask this, and they
 * have to agree — or a slash lands in the title of a task instead of in the
 * box, which is the sort of thing a person only forgives once.
 */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

/**
 * A plain key that works from anywhere on the board: `/` for the search box,
 * `n` for a new task. It is a printable character, so it belongs to whatever
 * field has the focus first, and it stays out of the task panel, whose keys
 * are the panel's own. A modifier turns it into somebody else's shortcut.
 */
export function useShortcut(key: string, handler: () => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== key || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      if ((event.target as HTMLElement | null)?.closest?.("aside")) return;
      event.preventDefault();
      latest.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key]);
}

/**
 * When the task panel closes, the focus goes back to the board's cursor, on
 * the task that was open. The panel lies over the canvas and not inside it,
 * so it cannot do this itself, and the cursor is already the one thing that
 * says which card holds the focus — a second way to remember a card would
 * soon disagree with it.
 *
 * Only a focus that has nowhere to be is taken. A panel closed by a click on
 * the search box, or on another card, leaves the focus where that click put
 * it.
 */
export function useCursorBack(openTaskId: string | null, back: (taskId: string) => void) {
  const was = useRef(openTaskId);
  const latest = useRef(back);
  useEffect(() => {
    latest.current = back;
  });
  useEffect(() => {
    const closed = was.current;
    was.current = openTaskId;
    if (!closed || openTaskId) return;
    const at = document.activeElement;
    if (at && at !== document.body) return;
    latest.current(closed);
  }, [openTaskId]);
}
