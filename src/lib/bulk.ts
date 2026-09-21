/**
 * The rules one bulk write obeys, apart from the database.
 *
 * Setting one property on many tasks is one call and not many: N calls coerce
 * the value N times, ring N doorbells, and can leave the board half set with
 * nothing on screen saying which half. So the route takes a list of ids, and
 * every rule that can refuse it lives here, where a test can ask it without a
 * server.
 */

/**
 * How many tasks one call may name.
 *
 * It is a ceiling and not a target. A board of this size is already more than
 * anybody picks by hand, and the statement that writes it holds every row in
 * memory, so the limit is what keeps one request from becoming a long one.
 */
export const BULK_LIMIT = 200;

export type IdsRead = { ok: true; ids: string[] } | { ok: false; said: string };

/**
 * What the caller named, or the sentence to refuse it with.
 *
 * The same id twice is one task, so the list is made unique before it is
 * counted: a caller that sends a duplicate meant one write, and two rows in
 * one statement about one task is what an upsert refuses outright.
 */
export function readTaskIds(raw: unknown): IdsRead {
  if (!Array.isArray(raw)) return { ok: false, said: "Name the tasks as a list of ids." };
  if (raw.some((id) => typeof id !== "string")) {
    return { ok: false, said: "Name the tasks as a list of ids." };
  }
  const ids = Array.from(new Set(raw as string[])).filter((id) => id !== "");
  if (ids.length === 0) return { ok: false, said: "Name at least one task." };
  if (ids.length > BULK_LIMIT) {
    return { ok: false, said: `That is more than ${BULK_LIMIT} tasks. Set fewer at once.` };
  }
  return { ok: true, ids };
}

/** One task as the database answers for it: on this board, and live or not. */
export type BulkRow = { id: string; archivedAt: Date | string | null };

/**
 * What the rows found say about the ids asked for, or null when nothing is
 * wrong.
 *
 * A whole call is refused rather than part of it. Writing the tasks it can
 * reach and dropping the rest would leave the board half set, and the answer
 * would have to say which half — which is the very thing one route exists to
 * avoid.
 *
 * An archived task is refused with the rest. No view draws one, so it cannot
 * be picked on a board; an id that names one came from somewhere else, and
 * setting a property on a card nobody can see is a change with nothing to show
 * for it. The way to change an archived task is to put it back first, which is
 * one press on the archive page.
 */
export function rowsSaid(ids: string[], rows: BulkRow[]): string | null {
  const found = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = found.get(id);
    if (!row) return "One of those tasks is not on this board.";
    if (row.archivedAt) return "One of those tasks is archived. Put it back first.";
  }
  return null;
}
