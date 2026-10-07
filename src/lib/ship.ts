import { isOver, type DoneWhen, type OverTask } from "./links";
import { isOpenOption } from "./option-dates";

/**
 * Shipping one column: the tasks that are over leave the board, the rest go
 * where the person said, and the option says the day it shipped.
 *
 * A sprint is closed rather than shipped. It answers "when", and a release
 * answers "what goes out", so only a release takes its finished work off the
 * board and into the changelog. A task can sit in Sprint 14 and in 0.20 at
 * once, and shipping 0.20 must not empty the sprint before its review.
 *
 * Everything here is pure. The route reads the rows under the project lock and
 * asks this file what to do with them; the column asks the same file what to
 * say, so the numbers in the question are the numbers the route works with.
 */

/** What happens to the tasks in the column that are not over. */
export const SHIP_RESTS = ["next", "leave", "clear"] as const;
export type ShipRest = (typeof SHIP_RESTS)[number];

/** What the route answers: the numbers that really went, and the day. */
export type ShipDone = { archived: number; moved: number; rest: ShipRest; shippedAt: string };

/** The words of each answer, as the column offers them. */
export const SHIP_REST_LABEL: Record<ShipRest, string> = {
  next: "Move to the next option",
  leave: "Leave them",
  clear: "Clear the value",
};

/** The body of a ship, read, or the sentence a 400 says. */
export function readShipRest(input: { rest?: unknown }): { rest: ShipRest } | { error: string } {
  const rest = input.rest;
  if (typeof rest === "string" && (SHIP_RESTS as readonly string[]).includes(rest)) {
    return { rest: rest as ShipRest };
  }
  return { error: 'Say what happens to the rest: "next", "leave" or "clear".' };
}

/**
 * The option after this one in the order everybody shares, or null when it is
 * the last. `options` is already in `position` order, as a property carries
 * them.
 */
export function nextOptionOf<T extends { id: string }>(options: T[], optionId: string): T | null {
  const at = options.findIndex((o) => o.id === optionId);
  return at >= 0 ? (options[at + 1] ?? null) : null;
}

/**
 * Where Move sends the rest: the next option that is still open. A shipped
 * sprint has no column, so work moved into it would leave the board.
 */
export function nextOpenOption<T extends { id: string; shippedAt: string | null }>(
  property: { type: string },
  options: T[],
  optionId: string,
): T | null {
  const open = options.filter((o) => o.id === optionId || isOpenOption(property, o));
  return nextOptionOf(open, optionId);
}

/**
 * True when the option closes rather than ships: an iteration. Closing archives
 * nothing and writes no changelog entry; the rest still moves or stays.
 */
export function closes(property: { type: string }): boolean {
  return property.type === "iteration";
}

/** The button word: a sprint is closed, a release is shipped. */
export function shipWord(closing: boolean): "Close" | "Ship" {
  return closing ? "Close" : "Ship";
}

/** The answers a column can offer: "next" only when there is a next option. */
export function shipRestsFor(hasNext: boolean): ShipRest[] {
  return SHIP_RESTS.filter((rest) => rest !== "next" || hasNext);
}

/** The tasks of the column, split by the project's done rule. */
export function splitShip<T extends OverTask & { id: string }>(
  tasks: T[],
  doneWhen: DoneWhen | null,
): { over: string[]; rest: string[] } {
  const over: string[] = [];
  const rest: string[] = [];
  for (const task of tasks) (isOver(task, doneWhen) ? over : rest).push(task.id);
  return { over, rest };
}

/** The question the column header asks, in real numbers. */
export function shipQuestion(name: string, over: number, rest: number, closing = false): string {
  const tasks = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;
  const left = rest === 0 ? "" : ` ${tasks(rest)} ${rest === 1 ? "is" : "are"} not over.`;
  if (closing) {
    const done = over === 0 ? "" : ` ${tasks(over)} ${over === 1 ? "is" : "are"} over and stay.`;
    return `Close ${name}?${done}${left}`;
  }
  return `Ship ${name}? ${tasks(over)} ${over === 1 ? "is" : "are"} over and will be archived.${left}`;
}

/** The day a ship writes. A date is a day, so it is the day in UTC. */
export function shipDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * What the header of an open sprint says once its end has passed, or null
 * before then. Nothing ends a sprint but a press of Close, so the header says
 * how long it has waited for one. Both are days, so they are counted in UTC.
 */
export function endedSaid(targetAt: string | null, today: string): string | null {
  if (!targetAt || targetAt >= today) return null;
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${targetAt}T00:00:00Z`)) / 86_400_000,
  );
  return days === 1 ? "Ended yesterday" : `Ended ${days} days ago`;
}

/** What the board says once a ship went through, in the server's numbers. */
export function shipSaid(
  name: string,
  done: ShipDone,
  nextName: string | null,
  closing = false,
): string {
  const tasks = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;
  const parts = closing ? [] : [`archived ${tasks(done.archived)}`];
  if (done.moved > 0) {
    parts.push(
      done.rest === "next" && nextName
        ? `moved ${tasks(done.moved)} to ${nextName}`
        : `cleared ${tasks(done.moved)}`,
    );
  }
  if (closing) return parts.length ? `Closed ${name}: ${parts.join(", ")}.` : `Closed ${name}.`;
  return `Shipped ${name}: ${parts.join(", ")}.`;
}
