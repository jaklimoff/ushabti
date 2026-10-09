/**
 * Which columns one person has folded to a strip.
 *
 * A fold is an answer to one screen, so it stays in the browser that made it
 * and nothing about it reaches the project: a folded Shipped column on the
 * owner's laptop must not take Shipped away from everybody else. It is held
 * per view, because a column id only means something inside the view that
 * draws it.
 */

const KEY = "ushabti:folded:";

export function foldKey(viewId: string): string {
  return KEY + viewId;
}

/**
 * The folded columns a browser wrote. What is stored belongs to the person,
 * not to us — it can be half written, hand edited or left by an older
 * version — so anything that is not a list of words reads as "nothing is
 * folded" rather than taking the board down.
 */
export function readFolded(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id !== "");
  } catch {
    return [];
  }
}

/** Folds a column, or opens it. A column is named once or not at all. */
export function setFolded(folded: string[], columnId: string, on: boolean): string[] {
  if (!on) return folded.filter((id) => id !== columnId);
  return folded.includes(columnId) ? folded : [...folded, columnId];
}

/* ------------------------------------------------------------------ */
/* The store the board subscribes to                                    */
/* ------------------------------------------------------------------ */

/*
 * The browser is not React's to see, so the board reads it as an outside
 * store rather than copying it into state after the first paint. The server
 * draws every column open, because it cannot know what one browser folded,
 * and the fold arrives the moment that browser takes over.
 */

const NOTHING: string[] = [];
const listeners = new Set<() => void>();

/**
 * The same answer for the same writing, because React compares by identity.
 * One entry per view: the project list reads the main view of every project
 * on one screen, and a single slot would hand each card a new answer.
 */
const cache = new Map<string, { raw: string | null; value: string[] }>();

export function subscribeFolded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function foldedOf(viewId: string): string[] {
  if (!viewId) return NOTHING;
  const key = foldKey(viewId);
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return NOTHING; /* private mode */
  }
  const held = cache.get(key);
  if (held && held.raw === raw) return held.value;
  /* A board with nothing folded gives the server's own answer back, word for
     word, so hydrating one costs no extra render. */
  const value = readFolded(raw);
  const fresh = { raw, value: value.length ? value : NOTHING };
  cache.set(key, fresh);
  return fresh.value;
}

/** What the server draws: a board nobody has folded yet. */
export function noFolds(): string[] {
  return NOTHING;
}

export function writeFolded(viewId: string, folded: string[]): void {
  if (!viewId) return;
  try {
    window.localStorage.setItem(foldKey(viewId), JSON.stringify(folded));
  } catch {
    /* private mode */
  }
  for (const listener of listeners) listener();
}
