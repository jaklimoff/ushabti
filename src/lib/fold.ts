/**
 * Which columns one person has folded to a strip.
 *
 * A fold is an answer to one screen, so it stays in the browser that made it
 * and nothing about it reaches the project: a folded Shipped column on the
 * owner's laptop must not take Shipped away from everybody else. It is held
 * per view, because a column id only means something inside the view that
 * draws it.
 */

import { hasOptions, type PropertyDTO } from "./types";

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

/**
 * The columns a view starts with folded, for a browser that never folded or
 * opened one there. It is read afresh, as a filter is: nothing cleans it up
 * when an option is deleted or the view is grouped by another property, so
 * an id that is not an option of the grouping property today is dropped
 * here, on every read.
 */
export function readStartFolded(
  raw: unknown,
  groupById: string | null,
  properties: PropertyDTO[],
): string[] {
  if (!Array.isArray(raw) || !groupById) return [];
  const group = properties.find((p) => p.id === groupById);
  if (!group || !hasOptions(group.type)) return [];
  return group.options.map((o) => o.id).filter((id) => raw.includes(id));
}

/* ------------------------------------------------------------------ */
/* The store the board subscribes to                                    */
/* ------------------------------------------------------------------ */

/*
 * The browser is not React's to see, so the board reads it as an outside
 * store rather than copying it into state after the first paint. The server
 * draws the view's starting fold, because it cannot know what one browser
 * folded, and the person's own fold arrives the moment that browser takes
 * over. A browser that never wrote a fold for the view has no answer of its
 * own and keeps the view's; once it folds or opens any column, even back to
 * none, the answer is the person's for good.
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

export function foldedOf(viewId: string, start: string[] = NOTHING): string[] {
  if (!viewId) return NOTHING;
  const key = foldKey(viewId);
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return start; /* private mode */
  }
  if (raw === null) return start;
  const held = cache.get(key);
  if (held && held.raw === raw) return held.value;
  const value = readFolded(raw);
  const fresh = { raw, value: value.length ? value : NOTHING };
  cache.set(key, fresh);
  return fresh.value;
}

/** What the server draws: the view's starting fold, or nothing. */
export function noFolds(start: string[] = NOTHING): string[] {
  return start;
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
