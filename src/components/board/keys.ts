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
