import type { TaskDTO } from "./types";

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
 */

/** How many hits the box draws. A longer list is a second board. */
export const SEARCH_LIMIT = 12;

/** How much of a description line a hit carries. */
const SNIPPET_LENGTH = 90;

export type SearchHit = {
  task: TaskDTO;
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
function rankOf(task: TaskDTO, whole: string, words: string[]): number {
  const key = task.key.toLowerCase();
  if (key === whole || String(task.number) === whole) return 0;
  if (key.startsWith(whole)) return 1;

  const title = task.title.toLowerCase();
  if (title.startsWith(whole)) return 2;
  if (words.every((word) => title.includes(word))) return 3;
  return 4;
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

export function searchTasks(
  tasks: TaskDTO[],
  query: string,
  limit: number = SEARCH_LIMIT,
): SearchHit[] {
  const whole = query.trim().toLowerCase();
  if (!whole) return [];
  const words = whole.split(/\s+/);

  const found: { rank: number; hit: SearchHit }[] = [];
  for (const task of tasks) {
    const haystack = `${task.key}\n${task.title}\n${task.description}`.toLowerCase();
    /* Every word has to be somewhere, exactly as every filter rule has to
       pass. A second word narrows the answer; it never widens it. */
    if (!words.every((word) => haystack.includes(word))) continue;

    const rank = rankOf(task, whole, words);
    found.push({
      rank,
      hit: { task, snippet: rank === 4 ? lineWith(task.description, words) : null },
    });
  }

  return found
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      /* Two equally good hits come back in the one order every view shares,
         so the same words always answer in the same order. */
      const one = a.hit.task.position;
      const other = b.hit.task.position;
      return one < other ? -1 : one > other ? 1 : 0;
    })
    .slice(0, limit)
    .map((f) => f.hit);
}
