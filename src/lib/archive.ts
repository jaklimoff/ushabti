import type { ArchivedTaskDTO } from "./types";

/**
 * The two rules the archive page draws by.
 *
 * They are here rather than in the page because they are pure: an order and a
 * narrowing, both answered from the rows the browser already carries. The page
 * asks the server nothing.
 */

/**
 * Newest archived first.
 *
 * A whole column is archived in one statement, so every task in it carries the
 * same moment to the millisecond. The rank every view shares breaks the tie,
 * exactly as it does in a sorted list, so the page never shuffles and a sweep
 * reads in the order the board kept.
 */
export function archiveOrder(rows: ArchivedTaskDTO[]): ArchivedTaskDTO[] {
  return [...rows].sort((a, b) => {
    const when = Date.parse(b.archivedAt) - Date.parse(a.archivedAt);
    if (when !== 0) return when;
    return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
  });
}

/**
 * The rows that answer to these words, in the order they came in.
 *
 * This is not `searchTasks`. That one ranks every task in the project, keeps
 * twelve and ends by opening one; this one narrows a list already on screen
 * and has to leave its order alone, or the page would reorder itself as
 * somebody types. It reads the key and the title and nothing else, because
 * those are the two things a row draws: a hit on a word nobody can see on the
 * page reads as a fault.
 */
export function narrowArchive(rows: ArchivedTaskDTO[], query: string): ArchivedTaskDTO[] {
  const whole = query.trim().toLowerCase();
  if (!whole) return rows;
  /* Every word has to be somewhere, exactly as every filter rule has to pass.
     A second word narrows the answer; it never widens it. */
  const words = whole.split(/\s+/);
  return rows.filter((task) => {
    const haystack = `${task.key}\n${task.title}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
