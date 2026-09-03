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
