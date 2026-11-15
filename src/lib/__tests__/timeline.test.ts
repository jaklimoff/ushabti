import { describe, expect, it } from "vitest";
import {
  changedDates,
  firstDates,
  movedDates,
  spanWords,
  sweptDates,
  lateWords,
  readTimelineDates,
  spanOf,
  timelineRows,
  type TimelineDates,
} from "../timeline";
import type { PropertyDTO } from "../types";

const prop = (id: string, type: string) =>
  ({ id, name: id, type, position: id, config: {}, options: [] }) as unknown as PropertyDTO;

const START = prop("p-start", "date");
const DUE = prop("p-due", "date");
const STATUS = prop("p-status", "select");
const PROPERTIES = [STATUS, DUE, START];
const DATES: TimelineDates = { startBy: "p-start", endBy: "p-due" };
const TODAY = "2026-11-15";

type T = {
  id: string;
  values: Record<string, unknown>;
  checklistDone: number;
  checklistTotal: number;
  done?: boolean;
};
const task = (id: string, values: Record<string, unknown>, extra: Partial<T> = {}): T => ({
  id,
  values,
  checklistDone: 0,
  checklistTotal: 0,
  ...extra,
});
const rows = (tasks: T[], dates = DATES) => timelineRows(tasks, dates, TODAY, (t) => !!t.done);

describe("the two dates a timeline reads", () => {
  it("keeps two pointers to date properties", () => {
    expect(readTimelineDates(DATES, PROPERTIES)).toEqual(DATES);
  });

  it("reads a property that is gone as none", () => {
    expect(readTimelineDates({ startBy: "p-gone", endBy: "p-due" }, PROPERTIES)).toEqual({
      startBy: null,
      endBy: "p-due",
    });
  });

  it("reads a property that is not a date as none", () => {
    expect(readTimelineDates({ startBy: "p-start", endBy: "p-status" }, PROPERTIES)).toEqual({
      startBy: "p-start",
      endBy: null,
    });
  });

  it("reads nothing it cannot make sense of", () => {
    for (const raw of [undefined, null, "p-due", [], 3])
      expect(readTimelineDates(raw, PROPERTIES)).toEqual({ startBy: null, endBy: null });
  });

  it("starts a new timeline on the first date for the end and the next for the start", () => {
    expect(firstDates(PROPERTIES)).toEqual({ endBy: "p-due", startBy: "p-start" });
    expect(firstDates([STATUS, DUE])).toEqual({ endBy: "p-due", startBy: null });
    expect(firstDates([STATUS])).toEqual({ endBy: null, startBy: null });
  });
});

describe("the rows of a timeline", () => {
  it("draws a bar from the start to the end", () => {
    const [row] = rows([task("a", { "p-start": "2026-11-16", "p-due": "2026-11-24" })]).dated;
    expect(row).toMatchObject({ shape: "bar", start: "2026-11-16", end: "2026-11-24", late: 0 });
    expect(spanOf(row)).toEqual({ start: "2026-11-16", end: "2026-11-24" });
  });

  it("draws a one day bar when the start is the end", () => {
    const [row] = rows([task("a", { "p-start": "2026-11-20", "p-due": "2026-11-20" })]).dated;
    expect(row.shape).toBe("bar");
  });

  it("draws a diamond on the end day with no start", () => {
    const [row] = rows([task("a", { "p-due": "2026-11-27" })]).dated;
    expect(row).toMatchObject({ shape: "point", start: "2026-11-27", end: "2026-11-27" });
  });

  it("draws a diamond when the view starts on nothing", () => {
    const [row] = rows([task("a", { "p-start": "2026-11-16", "p-due": "2026-11-27" })], {
      startBy: null,
      endBy: "p-due",
    }).dated;
    expect(row.shape).toBe("point");
  });

  it("draws no bar when the start is after the end, and corrects nothing", () => {
    const t = task("a", { "p-start": "2026-12-21", "p-due": "2026-12-14" });
    const [row] = rows([t]).dated;
    expect(row).toMatchObject({ shape: "backwards", end: "2026-12-14", said: "2026-12-21" });
    expect(spanOf(row)).toEqual({ start: "2026-12-14", end: "2026-12-21" });
    expect(t.values).toEqual({ "p-start": "2026-12-21", "p-due": "2026-12-14" });
  });

  it("fills a bar by its checklist", () => {
    const [row] = rows([
      task(
        "a",
        { "p-start": "2026-11-10", "p-due": "2026-11-24" },
        { checklistDone: 3, checklistTotal: 5 },
      ),
    ]).dated;
    expect(row.checklist).toEqual({ done: 3, total: 5 });
    expect(rows([task("b", { "p-due": "2026-11-24" })]).dated[0].checklist).toBeNull();
  });

  it("says how many days over an open task is", () => {
    const [row] = rows([task("a", { "p-start": "2026-11-05", "p-due": "2026-11-12" })]).dated;
    expect(row).toMatchObject({ over: false, late: 3 });
    expect(lateWords(row.late)).toBe("3 days over");
    expect(lateWords(1)).toBe("1 day over");
  });

  it("is not over on the day it ends", () => {
    expect(rows([task("a", { "p-due": TODAY })]).dated[0].late).toBe(0);
  });

  it("never calls a task that is over late", () => {
    const [row] = rows([task("a", { "p-due": "2026-11-06" }, { done: true })]).dated;
    expect(row).toMatchObject({ over: true, late: 0 });
  });

  it("puts a task with no end under Not scheduled", () => {
    const a = task("a", { "p-start": "2026-11-16" });
    const b = task("b", { "p-due": "not a day" });
    const timeline = rows([a, b]);
    expect(timeline.dated).toEqual([]);
    expect(timeline.unscheduled).toEqual([a, b]);
  });

  it("puts every task under Not scheduled when nothing says where the bars end", () => {
    const a = task("a", { "p-due": "2026-11-16" });
    expect(rows([a], { startBy: "p-start", endBy: null })).toEqual({
      dated: [],
      unscheduled: [a],
    });
  });

  it("keeps the order it was given", () => {
    const tasks = [
      task("late", { "p-due": "2026-12-20" }),
      task("none", {}),
      task("soon", { "p-due": "2026-11-20" }),
    ];
    const timeline = rows(tasks);
    expect(timeline.dated.map((r) => r.task.id)).toEqual(["late", "soon"]);
    expect(timeline.unscheduled.map((t) => t.id)).toEqual(["none"]);
  });
});

describe("moving a held bar", () => {
  const bar = { shape: "bar" as const, start: "2026-11-20", end: "2026-11-25" };
  const point = { shape: "point" as const, start: "2026-11-25", end: "2026-11-25" };

  it("moves both days of the body by the same whole days", () => {
    expect(movedDates(bar, "body", 3)).toEqual({ start: "2026-11-23", end: "2026-11-28" });
    expect(movedDates(bar, "body", -21)).toEqual({ start: "2026-10-30", end: "2026-11-04" });
    expect(movedDates(bar, "body", 0)).toEqual({ start: bar.start, end: bar.end });
  });

  it("moves only the start with the left end, and only the end with the right", () => {
    expect(movedDates(bar, "start", -4)).toEqual({ start: "2026-11-16", end: bar.end });
    expect(movedDates(bar, "start", 2)).toEqual({ start: "2026-11-22", end: bar.end });
    expect(movedDates(bar, "end", 6)).toEqual({ start: bar.start, end: "2026-12-01" });
    expect(movedDates(bar, "end", -2)).toEqual({ start: bar.start, end: "2026-11-23" });
  });

  it("stops an end one day short of the other", () => {
    expect(movedDates(bar, "start", 30)).toEqual({ start: "2026-11-24", end: bar.end });
    expect(movedDates(bar, "end", -30)).toEqual({ start: bar.start, end: "2026-11-21" });
  });

  it("lets the end of a one-day bar move only away from the other", () => {
    const one = { shape: "bar" as const, start: "2026-11-20", end: "2026-11-20" };
    expect(movedDates(one, "end", -3)).toEqual({ start: one.start, end: one.end });
    expect(movedDates(one, "end", 2)).toEqual({ start: one.start, end: "2026-11-22" });
    expect(movedDates(one, "start", 3)).toEqual({ start: one.start, end: one.end });
    expect(movedDates(one, "start", -1)).toEqual({ start: "2026-11-19", end: one.end });
  });

  it("drags a diamond whole, whichever end is named, and it moves its end", () => {
    for (const grip of ["body", "start", "end"] as const) {
      expect(movedDates(point, grip, 4)).toEqual({ start: "2026-11-29", end: "2026-11-29" });
    }
  });

  it("crosses months and years by whole days", () => {
    const late = { shape: "bar" as const, start: "2026-12-30", end: "2026-12-31" };
    expect(movedDates(late, "body", 2)).toEqual({ start: "2027-01-01", end: "2027-01-02" });
  });
});

describe("what a move writes", () => {
  const was = { start: "2026-11-20", end: "2026-11-25" };

  it("writes each date that changed, and nothing for the same days", () => {
    expect(changedDates(was, { start: "2026-11-21", end: "2026-11-26" }, DATES, true)).toEqual([
      { propertyId: "p-start", value: "2026-11-21" },
      { propertyId: "p-due", value: "2026-11-26" },
    ]);
    expect(changedDates(was, { start: was.start, end: "2026-11-26" }, DATES, true)).toEqual([
      { propertyId: "p-due", value: "2026-11-26" },
    ]);
    expect(changedDates(was, was, DATES, true)).toEqual([]);
  });

  it("writes only the end of a diamond and of a timeline with no start", () => {
    const now = { start: "2026-11-27", end: "2026-11-27" };
    expect(changedDates({ start: null, end: was.end }, now, DATES, false)).toEqual([
      { propertyId: "p-due", value: "2026-11-27" },
    ]);
    expect(changedDates(was, now, { startBy: null, endBy: "p-due" }, true)).toEqual([
      { propertyId: "p-due", value: "2026-11-27" },
    ]);
  });

  it("gives an empty row both days, whichever way it was dragged", () => {
    const swept = sweptDates("2026-11-30", "2026-11-22", true);
    expect(swept).toEqual({ start: "2026-11-22", end: "2026-11-30" });
    expect(changedDates({ start: null, end: null }, swept, DATES, true)).toEqual([
      { propertyId: "p-start", value: "2026-11-22" },
      { propertyId: "p-due", value: "2026-11-30" },
    ]);
    expect(sweptDates("2026-11-22", "2026-11-30", false)).toEqual({
      start: "2026-11-30",
      end: "2026-11-30",
    });
  });

  it("says the span a held bar will stand on, both days in", () => {
    const format = (d: string) => d.slice(5);
    expect(spanWords({ start: "2026-11-23", end: "2026-12-04" }, format)).toBe(
      "11-23 – 12-04 · 12 days",
    );
    expect(spanWords({ start: "2026-12-04", end: "2026-12-04" }, format)).toBe("12-04 · 1 day");
  });
});
