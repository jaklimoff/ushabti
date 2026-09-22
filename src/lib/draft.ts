/**
 * A composer's unsent words.
 *
 * A field saves when you leave it, and a tab closed on one sends what the
 * blur would have sent. A composer cannot do that, because a composer creates
 * and a create is not a save: a tab closed on a half-typed title must not make
 * a task. So the words are kept rather than sent, and they are there when you
 * come back.
 *
 * They are one person's unfinished sentence and nothing to do with the
 * project, so they stay in the browser that typed them and never reach the
 * server.
 *
 * Only the comment box keeps a draft. The other three composers — a task at
 * the top of a column, a task at the end of a list, a new option in settings —
 * write what they hold the moment the focus leaves, so words put back in one
 * of them would become a task or an option by themselves, which is the create
 * on leave this must not do. They also hold one line. A long note is what
 * hurts to lose.
 *
 * `localStorage` and not `sessionStorage`, because `sessionStorage` is emptied
 * when the tab closes, and a closed tab is the whole of the problem. The price
 * is that two tabs open on one task share one draft, and the second to write
 * wins; they also share the one comment they are both writing, so nothing is
 * lost that the person did not already have twice.
 */

const KEY = "ushabti:draft:";

/** One key per composer. A note belongs to the task it answers. */
export function commentDraftKey(taskId: string): string {
  return `${KEY}comment:${taskId}`;
}

/* ------------------------------------------------------------------ */
/* The store a composer subscribes to                                   */
/* ------------------------------------------------------------------ */

/*
 * The browser is not React's to see, so a composer reads its draft as an
 * outside store rather than copying it into state after the first paint.
 *
 * `typed` is what this page knows. Storage may refuse a read or a write — a
 * private window, a browser that blocks site data, a quota that is full — and
 * a box whose only memory was storage would then show nothing back as you
 * typed. So every keystroke is held here first, and storage is only what
 * carries it past the closed tab.
 */
const typed = new Map<string, string>();
const listeners = new Set<() => void>();

export function subscribeDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What was typed under this key, in this page or in an earlier one. */
export function draftOf(key: string): string {
  const here = typed.get(key);
  if (here !== undefined) return here;
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return ""; /* private mode */
  }
}

/** What the server draws: a composer nobody has typed in. */
export function noDraft(): string {
  return "";
}

/**
 * Keeps what was typed, or throws it away when the box is empty. Sending a
 * comment and emptying the box by hand are the same thing here: there is
 * nothing left to put back.
 */
export function writeDraft(key: string, text: string): void {
  if (text) typed.set(key, text);
  else typed.delete(key);
  try {
    if (text) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
  for (const listener of listeners) listener();
}
