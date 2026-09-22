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

/** Where every comment draft sits, whichever project it belongs to. */
const COMMENT = `${KEY}comment:`;

/** Where this project's comment drafts sit. The sweep below reads it. */
function commentKeys(projectId: string): string {
  return COMMENT + projectId + ":";
}

/**
 * One key per composer. A note belongs to the task it answers.
 *
 * The project is named as well, because one browser holds every project a
 * person works on and only that project's own board can say which of its
 * notes still have a task to sit on.
 */
export function commentDraftKey(projectId: string, taskId: string): string {
  return commentKeys(projectId) + taskId;
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

/* ------------------------------------------------------------------ */
/* The sweep                                                            */
/* ------------------------------------------------------------------ */

/**
 * Throws away the notes of this project that no task can carry.
 *
 * A draft outlives the task it was typed on. The task is deleted on the
 * server — by somebody else, or thirty days later by the sweep that ends the
 * window — and the browser that holds the note may not even be open at the
 * time, so nothing on the delete can reach the key. The board read is where
 * they are counted instead: it names every task the project still has, live
 * and archived, and a key naming any other task is a note nobody can open
 * again.
 *
 * A note that is only whitespace goes the same way, whatever task it is on.
 * `send()` refuses to send one, so it would sit there for ever and fill a box
 * that reads as empty. So does a key from before the project was in one: it
 * names a task and nothing else, so no board can ever claim it, and left
 * alone it would be the very note nobody can reach.
 *
 * It touches the browser and never what this page is holding: a box open on a
 * draft goes on showing what is in it, and nothing moves under the person's
 * hands. What it drops is only what a later tab would have read back.
 *
 * The cost is the drawer. A deleted task comes back whole for thirty days,
 * but it is on no board and never could be, so a board read cannot tell it
 * from one that is gone for good: a task put back comes back without the note
 * nobody sent.
 */
export function sweepDrafts(projectId: string, held: Iterable<string>): void {
  const mine = commentKeys(projectId);
  const tasks = new Set(held);
  const keys: string[] = [];
  try {
    const store = window.localStorage;
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(COMMENT)) keys.push(key);
    }
  } catch {
    return; /* private mode */
  }
  for (const key of keys) {
    try {
      const tail = key.slice(COMMENT.length);
      /* A key written before the project was in one names a task and nothing
         else, so no board can ever say whose it is or whether the task is
         still there. It is exactly the note nobody can reach, so the first
         board to sweep takes it. */
      if (!tail.includes(":")) {
        window.localStorage.removeItem(key);
        continue;
      }
      if (!key.startsWith(mine)) continue; /* another project's to answer for */
      const text = window.localStorage.getItem(key) ?? "";
      if (text.trim() && tasks.has(key.slice(mine.length))) continue;
      window.localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  }
}
