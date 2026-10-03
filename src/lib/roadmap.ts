import { todayIn } from "./day";
import type { DoneWhen, OverTask } from "./links";
import { progressOf } from "./progress";
import type { ArchivedUnder, PropertyDTO } from "./types";
import { isSelect } from "./types";

/**
 * The roadmap: one row per option of a select that carries a target date.
 *
 * A row is a release, not a task. A small team reads its plan as a handful of
 * versions with dates, and a bar per task would bury those under the work.
 */

/** A task as the roadmap reads it: what it is under, and when it was made. */
export type RoadmapTask = OverTask & { createdAt: string };

export type RoadmapRow = {
  id: string;
  name: string;
  color: string;
  /** The first day of the bar, as YYYY-MM-DD. */
  start: string;
  /** The last day of the bar: the shipped day once it shipped, else the target. */
  end: string;
  targetAt: string;
  shippedAt: string | null;
  done: number;
  total: number;
  /** How much of the bar is filled, from 0 to 1. A shipped bar is full. */
  share: number;
  /** The archived tasks under it, which no view draws: what a ship took away. */
  archived: number;
};

export type RoadmapRule = { doneWhen: DoneWhen | null; countBy: string | null };

/**
 * The rows, in option order with the shipped ones below the open ones.
 *
 * The start reads every task under the option, archived ones too, because the
 * day a release began moves with neither a filter nor a ship. The fill reads
 * only the live tasks the view's filters left, as the column header does, so
 * the bar agrees with the board.
 */
export function roadmapRows(
  property: PropertyDTO,
  all: RoadmapTask[],
  visible: RoadmapTask[],
  rule: RoadmapRule,
  timeZone: string,
  archived: Record<string, ArchivedUnder> = {},
): RoadmapRow[] {
  if (!isSelect(property.type)) return [];
  const under = (tasks: RoadmapTask[], id: string) =>
    tasks.filter((t) => t.values[property.id] === id);

  const rows: RoadmapRow[] = [];
  for (const option of property.options) {
    if (!option.targetAt) continue;
    const gone = archived[option.id];
    const start =
      option.startAt ??
      oldestDay([...under(all, option.id).map((t) => t.createdAt), gone?.firstAt], timeZone);
    // Nothing says when it began: no start, and no task to date it by.
    if (!start) continue;
    const end = option.shippedAt ?? option.targetAt;
    const { done, total } = progressOf(under(visible, option.id), rule.doneWhen, rule.countBy);
    rows.push({
      id: option.id,
      name: option.name,
      color: option.color,
      // A start after the end draws a bar of one day rather than none.
      start: start > end ? end : start,
      end,
      targetAt: option.targetAt,
      shippedAt: option.shippedAt,
      done,
      total,
      share: option.shippedAt ? 1 : total > 0 ? Math.min(1, Math.max(0, done / total)) : 0,
      archived: gone?.count ?? 0,
    });
  }
  return [...rows.filter((r) => !r.shippedAt), ...rows.filter((r) => r.shippedAt)];
}

/* The day the oldest task was made, in the project's zone, so the bar starts
   on the day the people saw it start. */
function oldestDay(moments: (string | undefined)[], timeZone: string): string | null {
  let oldest: string | null = null;
  for (const at of moments) if (at && (!oldest || at < oldest)) oldest = at;
  if (!oldest) return null;
  const at = new Date(oldest);
  return Number.isNaN(at.getTime()) ? null : todayIn(timeZone, at);
}

const DAY = 86_400_000;

/** Days since 1970 for a YYYY-MM-DD day. Pure arithmetic, so no zone moves it. */
export function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

export function dayOf(number: number): string {
  return new Date(number * DAY).toISOString().slice(0, 10);
}

export type RoadmapAxis = {
  /** The Monday the axis opens on. */
  first: number;
  /** The Monday of each week on the axis, as YYYY-MM-DD. */
  weeks: string[];
};

/**
 * Weeks, from the week before the first thing on the roadmap to the week after
 * the last. Today is always on it, so the line always has somewhere to stand.
 */
export function roadmapAxis(rows: RoadmapRow[], today: string): RoadmapAxis {
  const days = [today, ...rows.flatMap((r) => [r.start, r.end])].map(dayNumber);
  const first = monday(Math.min(...days)) - 7;
  const last = monday(Math.max(...days)) + 7;
  const weeks: string[] = [];
  for (let d = first; d <= last; d += 7) weeks.push(dayOf(d));
  return { first, weeks };
}

/* 1970-01-01 was a Thursday, so day 4 is the first Monday. */
function monday(day: number): number {
  return day - ((((day - 4) % 7) + 7) % 7);
}

/** How many days after the axis opens this day falls. */
export function daysIn(axis: RoadmapAxis, day: string): number {
  return dayNumber(day) - axis.first;
}

/**
 * What a bar holds, for the panel it opens.
 *
 * The live tasks come in the order the board draws them, already through the
 * view's filters, so the list agrees with the bar's fill. The archived ones
 * carry no values on the board, so no filter can reach them; they are listed
 * whole, in the order the server summed them in.
 */
export function optionTasks<
  T extends { values: Record<string, unknown> },
  A extends { id: string },
>(
  propertyId: string,
  optionId: string,
  ordered: T[],
  archived: A[],
  under: ArchivedUnder | undefined,
): { live: T[]; archived: A[] } {
  const byId = new Map(archived.map((t) => [t.id, t]));
  return {
    live: ordered.filter((t) => t.values[propertyId] === optionId),
    archived: (under?.taskIds ?? []).flatMap((id) => byId.get(id) ?? []),
  };
}
