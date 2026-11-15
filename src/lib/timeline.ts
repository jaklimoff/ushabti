/*
 * A timeline: one row per task, with a bar between two dates.
 *
 * The two dates are not fields. They are pointers to two date properties
 * somebody made, kept in `views.config.dates` and read afresh, as a filter is.
 * This module is the one place that says which rows a timeline has, which
 * section each one is in, and where a bar starts and ends. The days under
 * them come from `roadmap.ts`.
 */

import { dayNumber, dayOf as dayAt } from "./roadmap";
import type { PropertyDTO } from "./types";

/** The two date properties a timeline reads. Ends on is the one it needs. */
export type TimelineDates = { startBy: string | null; endBy: string | null };

export const NO_DATES: TimelineDates = { startBy: null, endBy: null };

/**
 * The two pointers, read afresh. A pointer to a property that is gone, or that
 * is no longer a date, reads as none. Nothing rewrites a view when a property
 * goes, so this is the only cleanup there is.
 */
export function readTimelineDates(raw: unknown, properties: PropertyDTO[]): TimelineDates {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_DATES;
  const { startBy, endBy } = raw as { startBy?: unknown; endBy?: unknown };
  const date = (id: unknown): string | null =>
    typeof id === "string" && properties.some((p) => p.id === id && p.type === "date") ? id : null;
  return { startBy: date(startBy), endBy: date(endBy) };
}

/** The date properties a timeline may name, in the project's order. */
export function dateProperties(properties: PropertyDTO[]): PropertyDTO[] {
  return properties.filter((p) => p.type === "date");
}

/**
 * The dates a new timeline starts on: Ends on the first date property, and
 * Starts on the next one, or none when there is only one.
 */
export function firstDates(properties: PropertyDTO[]): TimelineDates {
  const dates = dateProperties(properties);
  return { endBy: dates[0]?.id ?? null, startBy: dates[1]?.id ?? null };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayOf(value: unknown): string | null {
  return typeof value === "string" && DAY.test(value) ? value : null;
}

/** What a timeline needs of a task. The board's own `TaskDTO` fits. */
export type TimelineTask = {
  id: string;
  values: Record<string, unknown>;
  checklistDone: number;
  checklistTotal: number;
};

/**
 * One dated row.
 *
 * - `bar`: from `start` to `end`, both days in.
 * - `point`: no start, so the task is the one day it ends on: a diamond.
 * - `backwards`: the start is after the end. No bar, and nothing corrects it.
 */
export type TimelineRow<T> = {
  task: T;
  shape: "bar" | "point" | "backwards";
  /** The first day drawn. The end for a point; for a backwards row, too. */
  start: string;
  end: string;
  /** The start the task says, which a backwards row names in its chip. */
  said: string | null;
  /** The task is over: a full, dimmed bar, and "done" after its day. */
  over: boolean;
  /** Days its end is behind today, on a task that is not over. 0 when not. */
  late: number;
  /** The share of its checklist done, or null with no checklist. */
  checklist: { done: number; total: number } | null;
};

export type Timeline<T> = {
  /** The rows with an end, in the order they were given. */
  dated: TimelineRow<T>[];
  /** The tasks with no end, in the order they were given. */
  unscheduled: T[];
};

/**
 * The rows of a timeline, in the order the tasks come in: the view's filters
 * and its order are already on them, as a list's are. With no Ends on there
 * is no row at all, and every task waits under Not scheduled.
 */
export function timelineRows<T extends TimelineTask>(
  tasks: readonly T[],
  dates: TimelineDates,
  today: string,
  isOver: (task: T) => boolean,
): Timeline<T> {
  const dated: TimelineRow<T>[] = [];
  const unscheduled: T[] = [];
  for (const task of tasks) {
    const end = dates.endBy ? dayOf(task.values[dates.endBy]) : null;
    if (!end) {
      unscheduled.push(task);
      continue;
    }
    const said = dates.startBy ? dayOf(task.values[dates.startBy]) : null;
    const shape = !said ? "point" : said > end ? "backwards" : "bar";
    const over = isOver(task);
    dated.push({
      task,
      shape,
      start: shape === "bar" ? (said as string) : end,
      end,
      said,
      over,
      late: over ? 0 : Math.max(0, dayNumber(today) - dayNumber(end)),
      checklist:
        task.checklistTotal > 0 ? { done: task.checklistDone, total: task.checklistTotal } : null,
    });
  }
  return { dated, unscheduled };
}

/**
 * The days a row takes on the axis. A backwards row is drawn as a chip at its
 * end, but the start it names has to be on the axis too.
 */
export function spanOf(row: TimelineRow<unknown>): { start: string; end: string } {
  if (row.shape === "backwards" && row.said) return { start: row.end, end: row.said };
  return { start: row.start, end: row.end };
}

/** "3 days over": the words after an end that passed on an open task. */
export function lateWords(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} over`;
}

/**
 * What a pointer holds on a bar: its body, which moves both days, or one end.
 * A diamond is one day, so it is only ever held whole.
 */
export type Grip = "body" | "start" | "end";

/** The days a held bar stands on. A diamond's start is its end. */
export type HeldDays = { start: string; end: string };

/**
 * Where a held bar lands, moved so many whole days. The body and a diamond
 * move both days by the same count. An end moves alone and stops one day
 * short of the other, so it never passes it; on a one-day bar it can only
 * move away. Only a bar or a diamond is ever held: a backwards row has no
 * bar to hold, and nothing corrects it.
 */
export function movedDates(
  row: { shape: TimelineRow<unknown>["shape"]; start: string; end: string },
  grip: Grip,
  by: number,
): HeldDays {
  const start = dayNumber(row.start);
  const end = dayNumber(row.end);
  if (row.shape === "point" || grip === "body")
    return { start: dayAt(start + by), end: dayAt(end + by) };
  if (grip === "start")
    return { start: dayAt(Math.min(start + by, Math.max(end - 1, start))), end: row.end };
  return { start: row.start, end: dayAt(Math.max(end + by, Math.min(start + 1, end))) };
}

/**
 * The days a drag across an empty row gives it, from the day it was pressed
 * on to the day it was let go on, whichever way it went. With no Starts on,
 * the row is given only the day it ends on.
 */
export function sweptDates(from: string, to: string, hasStart: boolean): HeldDays {
  const [start, end] = from <= to ? [from, to] : [to, from];
  return hasStart ? { start, end } : { start: end, end };
}

/**
 * The values a move writes: each date that changed, and nothing for a date
 * that did not. A diamond keeps having no start, so it writes only its end,
 * and so does a timeline with no Starts on.
 */
export function changedDates(
  was: { start: string | null; end: string | null },
  now: HeldDays,
  dates: TimelineDates,
  withStart: boolean,
): { propertyId: string; value: string }[] {
  const out: { propertyId: string; value: string }[] = [];
  if (dates.startBy && withStart && now.start !== was.start)
    out.push({ propertyId: dates.startBy, value: now.start });
  if (dates.endBy && now.end !== was.end) out.push({ propertyId: dates.endBy, value: now.end });
  return out;
}

/** "Nov 23 – Dec 4 · 12 days": the days a held bar will stand on, both in. */
export function spanWords(days: HeldDays, format: (day: string) => string): string {
  const count = dayNumber(days.end) - dayNumber(days.start) + 1;
  const length = `${count} ${count === 1 ? "day" : "days"}`;
  if (days.start === days.end) return `${format(days.end)} · ${length}`;
  return `${format(days.start)} – ${format(days.end)} · ${length}`;
}
