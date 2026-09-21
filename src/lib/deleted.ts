/**
 * What a delete means now that it can be undone.
 *
 * A delete is a mark on the row, exactly as an archive is, and the mark runs
 * out. Everything that reads the window is here, where a test can ask it
 * without a server: the routes, the drawer and the sweep all count the same
 * days from the same number.
 */

/**
 * How long a deleted task can come back.
 *
 * One number, written in the docs, and not a project setting. A window every
 * project can set is a number every reader of the API has to ask for, and a
 * board that sets it to a day has built a delete nobody can undo.
 */
export const DELETE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const DELETE_WINDOW_MS = DELETE_WINDOW_DAYS * DAY_MS;

/** When a task deleted at this moment goes for good. */
export function goesAt(deletedAt: string | number | Date): string {
  const at = deletedAt instanceof Date ? deletedAt.getTime() : new Date(deletedAt).getTime();
  return new Date(at + DELETE_WINDOW_MS).toISOString();
}

/** The moment before which a deleted row is past its window. */
export function sweepCutoff(now: number): Date {
  return new Date(now - DELETE_WINDOW_MS);
}

/**
 * How many days are left, rounded up, and never below zero.
 *
 * Rounded up because the number answers "how long have I got": a task with an
 * hour to go has a day, not none. Zero says the window is over — the sweep
 * takes such a row on the next write or the next read of the drawer, so
 * nobody should see it for long.
 */
export function daysLeft(goes: string | number | Date, now: number): number {
  const at = goes instanceof Date ? goes.getTime() : new Date(goes).getTime();
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / DAY_MS));
}

/** The same number in the words a row wears. */
export function saysLeft(goes: string | number | Date, now: number): string {
  const days = daysLeft(goes, now);
  if (days === 0) return "Gone today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

export type DeletedAction = "deleted" | "restored";

/**
 * The `deleted` feed line, both ways round.
 *
 * `kind` stays `deleted` and the line grows an `action`, mirroring `archive`:
 * a receiver that watches `deleted` now hears a put back too and has to read
 * the action. The key is here because `taskId` is not — `activity.task_id`
 * cascades, so a line naming the task would be swept away with the task, and
 * the key is the one word that still points at it.
 *
 * `goesAt` is null on a put back. A task that is back has no window left to
 * name, and a moment that has stopped meaning anything is worse than none.
 */
export function deletedLine(input: {
  action: DeletedAction;
  key: string;
  title: string;
  goesAt: string | null;
}): Record<string, unknown> {
  return {
    action: input.action,
    key: input.key,
    title: input.title,
    goesAt: input.goesAt,
  };
}
