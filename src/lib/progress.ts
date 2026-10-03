import { isOver, type DoneWhen, type OverTask } from "./links";
import type { PropertyDTO } from "./types";

/**
 * How far a set of tasks has come.
 *
 * Nothing on a task is hardcoded, so this file knows neither Done nor a
 * point. Over is the project's own done rule, the one a blocker obeys, and
 * the unit is a number property the owner names, or a task when nobody has.
 * The column header asks it today; Ship and the roadmap ask the same
 * function, so one release cannot read two ways.
 */

/** What the tasks add up to: the part that is over, against all of it. */
export type Progress = { done: number; total: number };

/**
 * The number property this project counts progress by, made safe to use.
 *
 * Read afresh and never cleaned up, exactly as the done rule is: a project
 * that names a property that is gone, or that is no longer a number, counts
 * tasks again.
 */
export function readProgressBy(raw: unknown, properties: PropertyDTO[]): string | null {
  if (typeof raw !== "string") return null;
  const property = properties.find((p) => p.id === raw);
  return property && property.type === "number" ? raw : null;
}

/**
 * Sums the tasks that are over against all the tasks.
 *
 * With no property each task counts one. With one, a task counts its value,
 * and a task with no value counts zero: a blank is not an estimate, and a
 * guess here would move the bar nobody can explain.
 */
export function progressOf(
  tasks: OverTask[],
  doneWhen: DoneWhen | null,
  countBy: string | null,
): Progress {
  let done = 0;
  let total = 0;
  for (const task of tasks) {
    const weight = countBy ? numberOf(task.values[countBy]) : 1;
    total += weight;
    if (isOver(task, doneWhen)) done += weight;
  }
  return { done: settled(done), total: settled(total) };
}

/* A sum of 0.1 and 0.2 is 0.30000000000000004, and a header must not say it. */
function settled(sum: number): number {
  return Math.round(sum * 1e6) / 1e6;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
