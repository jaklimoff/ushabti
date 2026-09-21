/**
 * The shape of an id.
 *
 * Every id column on this board is a UUID, so Postgres refuses to cast
 * anything else and the refusal arrives as `500 Something went wrong on the
 * server.` — our fault, for a request that was simply wrong. The shape is read
 * here instead, before a query is made of it.
 *
 * The rule is kept apart from the refusal so that a test can ask it without a
 * server, and so that `readTaskIds` in `bulk.ts` can ask the same question and
 * answer with a sentence of its own instead of throwing. `readId()` in
 * `api.ts` is the one door a route comes in by.
 */

/*
 * Upper case passes. Postgres reads a UUID in either case and stores the one
 * form, so a caller that upper-cased an id we gave it still names the same
 * row. Nothing else is let in: no braces, no missing hyphen and no space
 * around it. A path carries whatever somebody typed, and an id that needs
 * tidying up first came from somewhere other than this API.
 */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Whether this is an id at all. */
export function isId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The sentence a bad id is refused with. `what` is "task", "run", "view"… */
export function notAnId(what: string): string {
  return `That is not a ${what} id.`;
}
