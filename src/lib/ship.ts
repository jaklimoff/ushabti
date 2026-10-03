import { isOver, type DoneWhen, type OverTask } from "./links";
import { isOpenOption } from "./option-dates";

/**
 * Shipping one column: the tasks that are over leave the board, the rest go
 * where the person said, and the option says the day it shipped.
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
export function shipQuestion(name: string, over: number, rest: number): string {
  const tasks = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;
  const left = rest === 0 ? "" : ` ${tasks(rest)} ${rest === 1 ? "is" : "are"} not over.`;
  return `Ship ${name}? ${tasks(over)} ${over === 1 ? "is" : "are"} over and will be archived.${left}`;
}

/** The day a ship writes. A date is a day, so it is the day in UTC. */
export function shipDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** What the board says once a ship went through, in the server's numbers. */
export function shipSaid(name: string, done: ShipDone, nextName: string | null): string {
  const tasks = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;
  const parts = [`archived ${tasks(done.archived)}`];
  if (done.moved > 0) {
    parts.push(
      done.rest === "next" && nextName
        ? `moved ${tasks(done.moved)} to ${nextName}`
        : `cleared ${tasks(done.moved)}`,
    );
  }
  return `Shipped ${name}: ${parts.join(", ")}.`;
}
