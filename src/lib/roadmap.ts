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
 * A bar with no start date begins the day after the previous dated option's
 * target, because a release starts when the one before it ends. Only the first
 * dated option has nothing before it, so it starts at its oldest task, archived
 * ones too, or today when it has none, because the day a release began moves with neither a filter nor a
 * ship. Reading the oldest task for every option let one old task moved into a
 * release start its bar years back. The fill reads
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
  today: string = todayIn(timeZone),
): RoadmapRow[] {
  if (!isSelect(property.type)) return [];
  const under = (tasks: RoadmapTask[], id: string) =>
    tasks.filter((t) => t.values[property.id] === id);

  const rows: RoadmapRow[] = [];
  let previousTarget: string | null = null;
  for (const option of property.options) {
    if (!option.targetAt) continue;
    const gone = archived[option.id];
    /* Nothing says when it began: no start, and no task to date it by. It
       has not begun, so it begins today, and a release made on the roadmap
       draws a row the moment it is made. */
    const start =
      option.startAt ??
      (previousTarget
        ? dayOf(dayNumber(previousTarget) + 1)
        : oldestDay([...under(all, option.id).map((t) => t.createdAt), gone?.firstAt], timeZone)) ??
      today;
    previousTarget = option.targetAt;
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
 * A short plan is given more weeks at the end, up to `minWeeks`, so a screen
 * wider than the plan draws its grid to the edge rather than stopping short.
 */
export function roadmapAxis(
  spans: { start: string; end: string }[],
  today: string,
  minWeeks = 0,
): RoadmapAxis {
  const days = [today, ...spans.flatMap((r) => [r.start, r.end])].map(dayNumber);
  const first = monday(Math.min(...days)) - 7;
  const last = Math.max(monday(Math.max(...days)) + 7, first + (minWeeks - 1) * 7);
  const weeks: string[] = [];
  for (let d = first; d <= last; d += 7) weeks.push(dayOf(d));
  return { first, weeks };
}

/* Written out, as `formatDate` writes them, so the server and the browser
   draw the same words whatever their locale. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type RoadmapMonth = {
  /** Days after the axis opens that the month begins. The first may be negative. */
  at: number;
  /** How many days of it the axis holds. */
  days: number;
  /** "Oct". */
  name: string;
  year: number;
  /** The year has to be said: the first month on the axis, and every January. */
  sayYear: boolean;
};

/**
 * The months the axis crosses, each at its true first day. A week line is a
 * Monday and a month rarely starts on one, so a month labelled at its first
 * Monday puts a bar that ends on the 1st in the month before.
 *
 * The year is written on the first month and on every January, because an
 * axis that runs into next year must say so.
 */
export function roadmapMonths(axis: RoadmapAxis): RoadmapMonth[] {
  const end = axis.first + axis.weeks.length * 7;
  const months: RoadmapMonth[] = [];
  let [y, m] = dayOf(axis.first).split("-").map(Number);
  for (;;) {
    const start = dayNumber(`${y}-${String(m).padStart(2, "0")}-01`);
    if (start >= end) break;
    const next = m === 12 ? [y + 1, 1] : [y, m + 1];
    const after = dayNumber(`${next[0]}-${String(next[1]).padStart(2, "0")}-01`);
    months.push({
      at: start - axis.first,
      days: Math.min(after, end) - Math.max(start, axis.first),
      name: MONTHS[m - 1],
      year: y,
      sayYear: months.length === 0 || m === 1,
    });
    [y, m] = next;
  }
  return months;
}

/**
 * Where a row stands against today, for the words beside its bar. It decides
 * nothing: the column header draws the same "ended" from the same dates.
 *
 * - `ended`: the target passed and it never shipped. It waits for Ship.
 * - `late`: a week or less to go and work still open.
 */
export type RoadmapState =
  { kind: "shipped" } | { kind: "ended" } | { kind: "late"; daysLeft: number } | { kind: "open" };

export function roadmapState(row: RoadmapRow, today: string): RoadmapState {
  if (row.shippedAt) return { kind: "shipped" };
  const daysLeft = dayNumber(row.end) - dayNumber(today);
  if (daysLeft < 0) return { kind: "ended" };
  if (daysLeft <= 7 && row.share < 1) return { kind: "late", daysLeft };
  return { kind: "open" };
}

/** A row that is ready to ship: its target passed, or every task in it is over. */
export function readyToShip(row: RoadmapRow, today: string): boolean {
  if (row.shippedAt) return false;
  return roadmapState(row, today).kind === "ended" || (row.total > 0 && row.done >= row.total);
}

/**
 * The target a bar's end moved so many days to. It stops at the bar's first
 * day, because a target before the start is what the option PATCH refuses.
 */
export function movedTarget(row: RoadmapRow, by: number): string {
  const target = dayNumber(row.targetAt);
  const start = dayNumber(row.start);
  /* A start worked out past the target is no start of the option's own, so
     the PATCH refuses nothing and the end is not pushed to it. */
  return dayOf(target < start ? target + by : Math.max(target + by, start));
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

/**
 * Where a release added now would start: the day after the last dated
 * option's target, as `roadmapRows` starts every option after the first, or
 * today when nothing is dated. The add row draws it before it is made.
 */
export function nextStart(property: PropertyDTO, today: string): string {
  const last = property.options.findLast((o) => o.targetAt)?.targetAt;
  return last ? dayOf(dayNumber(last) + 1) : today;
}
