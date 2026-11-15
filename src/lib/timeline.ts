/*
 * A timeline: one row per task, with a bar between two dates.
 *
 * The two dates are not fields. They are pointers to two date properties
 * somebody made, kept in `views.config.dates` and read afresh, as a filter is.
 * This module is the one place that says which rows a timeline has, which
 * section each one is in, and where a bar starts and ends. The days under
 * them come from `roadmap.ts`.
 */

import { dayNumber } from "./roadmap";
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
