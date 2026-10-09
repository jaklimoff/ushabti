import { isOver, type DoneWhen } from "./links";
import type { TaskDTO, TaskValue } from "./types";

/**
 * What a search reads of a task. A live task answers it and so does an
 * archived one, which the board carries in a lighter shape — the words, the
 * key, the rank it is tied in, and whether it is archived. The archived shape
 * carries no `updatedAt`, because its `archivedAt` is the last thing that
 * happened to it, and no `values`, because it is over whatever they say.
 */
export type Searchable = Pick<
  TaskDTO,
  "id" | "number" | "key" | "title" | "description" | "position"
> & { archivedAt?: string | null; updatedAt?: string; values?: Record<string, TaskValue> };

/**
 * Finding one task by its key, its title or its words.
 *
 * The whole board is already in the browser — every task, with its description
 * — so nothing is asked of the server and the answer arrives on the keystroke.
 *
 * A search is not a filter, and this is the difference: a filter says which
 * tasks a view shows and everybody sees it, while a search hides nothing,
 * writes nothing and ends by opening one task. So it looks at every task in
 * the project rather than at the ones the view is drawing, and a hit the view
 * is not showing is worth saying so about rather than worth throwing away.
 *
 * An archived task is the same case carried one step further: no view draws
 * it, and a search is the way back to it. So the caller hands in the archived
 * tasks beside the live ones, and the row says which it found.
 */

/** How many hits the box draws. A longer list is a second board. */
export const SEARCH_LIMIT = 12;

/** How much of a description line a hit carries. */
const SNIPPET_LENGTH = 90;

export type SearchHit = {
  task: Searchable;
  /**
   * The line of the description the words were found on, and only when the
   * key and the title do not carry them. A hit has to say why it is a hit.
   */
  snippet: string | null;
};

/**
 * How well a task answers, smallest first.
 *
 * The key is the address a person says out loud, so a key that is the whole
 * query wins outright: somebody who typed DP-4 wants DP-4, not the fourteen
 * tasks whose descriptions mention it. A bare number is read as a key too,
 * because that is the half of it people type. Then the title, and the
 * description last — a word in a paragraph is the weakest reason to put a row
 * at the top.
 */
function rankOf(task: Searchable, whole: string, words: string[]): number {
  const key = task.key.toLowerCase();
  if (key === whole || String(task.number) === whole) return 0;
  if (key.startsWith(whole)) return 1;

  const title = task.title.toLowerCase();
  if (title.startsWith(whole)) return 2;
  if (words.every((word) => title.includes(word))) return 3;
  return 4;
}

/**
 * Open first, then done but still on the board, then archived. "Done" is the
 * project's own Done when, read by `isOver` as blockers read it, so no option
 * is named here. With no Done when only archived counts, as before.
 */
function standing(task: Searchable, doneWhen: DoneWhen | null): number {
  if (task.archivedAt) return 2;
  return isOver({ archivedAt: null, values: task.values ?? {} }, doneWhen) ? 1 : 0;
}

/**
 * When a task last changed, as a number to compare. A time is read with
 * `Date.parse`, never as words, because a search runs on the server and in the
 * browser and the two do not share a locale.
 */
function lastChanged(task: Searchable): number {
  const when = task.archivedAt ?? task.updatedAt;
  return when ? Date.parse(when) : 0;
}

/** The first line of the description that carries one of the words. */
function lineWith(description: string, words: string[]): string | null {
  for (const line of description.split("\n")) {
    const said = line.trim();
    if (!said) continue;
    const lower = said.toLowerCase();
    if (!words.some((word) => lower.includes(word))) continue;
    return said.length > SNIPPET_LENGTH ? `${said.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…` : said;
  }
  return null;
}

/**
 * The word a hit carries about itself, or null when there is nothing to say.
 *
 * Archived comes first because it is the stronger reason: a task no view can
 * draw is not merely outside the one on screen.
 */
export function hitNote(task: Searchable, shown: boolean): string | null {
  if (task.archivedAt) return "archived";
  return shown ? null : "not in this view";
}

/** What a search found: the hits the box draws, and how many there were. */
export type SearchResult = { hits: SearchHit[]; total: number };

export function searchTasks(
  tasks: Searchable[],
  query: string,
  doneWhen: DoneWhen | null = null,
  limit: number = SEARCH_LIMIT,
  leaveOut: ReadonlySet<string> = new Set(),
): SearchHit[] {
  return searchCounted(tasks, query, doneWhen, limit, leaveOut).hits;
}

/* The total is taken after leaveOut and before the cut, so it counts what
   could be picked, not what fits in the box. */
export function searchCounted(
  tasks: Searchable[],
  query: string,
  doneWhen: DoneWhen | null = null,
  limit: number = SEARCH_LIMIT,
  /* The tasks a caller cannot offer, such as the ones already linked. They
     go before the cut, or twelve of them would fill the box and hide a
     thirteenth that could be picked. */
  leaveOut: ReadonlySet<string> = new Set(),
): SearchResult {
  const whole = query.trim().toLowerCase();
  if (!whole) return { hits: [], total: 0 };
  const words = whole.split(/\s+/);

  const found: { rank: number; standing: number; hit: SearchHit }[] = [];
  for (const task of tasks) {
    if (leaveOut.has(task.id)) continue;
    const haystack = `${task.key}\n${task.title}\n${task.description}`.toLowerCase();
    /* Every word has to be somewhere, exactly as every filter rule has to
       pass. A second word narrows the answer; it never widens it. */
    if (!words.every((word) => haystack.includes(word))) continue;

    const rank = rankOf(task, whole, words);
    found.push({
      rank,
      standing: standing(task, doneWhen),
      hit: { task, snippet: rank === 4 ? lineWith(task.description, words) : null },
    });
  }

  const hits = found
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      /* Two equally good hits put open work first and then the newest: a
         finished task must not push live work out of the box, and an old task
         must not push the one changed this week. The rank still wins, so a key
         typed in full opens its task even when it is done. The cut to the
         limit comes after this, so the order also decides what shows. */
      if (a.standing !== b.standing) return a.standing - b.standing;
      const newer = lastChanged(b.hit.task) - lastChanged(a.hit.task);
      if (newer !== 0) return newer;
      /* Equal times come back in the one order every view shares, so the
         same words on the same board always answer in the same order. */
      const one = a.hit.task.position;
      const other = b.hit.task.position;
      return one < other ? -1 : one > other ? 1 : 0;
    })
    .slice(0, limit)
    .map((f) => f.hit);
  return { hits, total: found.length };
}
