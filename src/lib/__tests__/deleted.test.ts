import { describe, expect, it } from "vitest";
import {
  DELETE_WINDOW_DAYS,
  DELETE_WINDOW_MS,
  daysLeft,
  deletedLine,
  goesAt,
  saysLeft,
  sweepCutoff,
} from "../deleted";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const AT = "2026-03-01T12:00:00.000Z";
const at = Date.parse(AT);

describe("the window", () => {
  it("is thirty days, and the two numbers agree", () => {
    expect(DELETE_WINDOW_DAYS).toBe(30);
    expect(DELETE_WINDOW_MS).toBe(30 * DAY);
  });

  it("counts from the moment the task went", () => {
    expect(goesAt(AT)).toBe(new Date(at + 30 * DAY).toISOString());
  });

  it("reads a string, a number and a Date the same way", () => {
    expect(goesAt(new Date(at))).toBe(goesAt(AT));
    expect(goesAt(at)).toBe(goesAt(AT));
  });

  /* The sweep asks the question the other way round: which rows went so long
     ago that their window is over. */
  it("sweeps a row deleted exactly one window ago", () => {
    expect(sweepCutoff(at).toISOString()).toBe(new Date(at - 30 * DAY).toISOString());
  });
});

describe("daysLeft", () => {
  const goes = goesAt(AT);

  it("is the whole window on the day it went", () => {
    expect(daysLeft(goes, at)).toBe(30);
  });

  /* Rounded up, because the number answers "how long have I got": an hour is
     not none. */
  it("rounds a part of a day up", () => {
    expect(daysLeft(goes, at + HOUR)).toBe(30);
    expect(daysLeft(goes, at + DAY)).toBe(29);
    expect(daysLeft(goes, at + DAY + HOUR)).toBe(29);
    expect(daysLeft(goes, at + 29 * DAY)).toBe(1);
    expect(daysLeft(goes, at + 29 * DAY + HOUR)).toBe(1);
  });

  it("is zero at the end of the window, and never less", () => {
    expect(daysLeft(goes, at + 30 * DAY)).toBe(0);
    expect(daysLeft(goes, at + 90 * DAY)).toBe(0);
  });

  /* A row that cannot be read is a row with no time left, rather than one
     that throws while a page is drawing. */
  it("says nothing is left for a moment it cannot read", () => {
    expect(daysLeft("not a date", at)).toBe(0);
  });
});

describe("saysLeft", () => {
  const goes = goesAt(AT);

  it("counts the days in words a row wears", () => {
    expect(saysLeft(goes, at)).toBe("30 days left");
    expect(saysLeft(goes, at + 28 * DAY)).toBe("2 days left");
  });

  it("says one day without the s", () => {
    expect(saysLeft(goes, at + 29 * DAY)).toBe("1 day left");
  });

  it("says today when the window is over", () => {
    expect(saysLeft(goes, at + 30 * DAY)).toBe("Gone today");
  });
});

describe("the deleted feed line", () => {
  /* The key is here because `taskId` is not: `activity.task_id` cascades, so a
     line naming the task would be swept away with the task it records. */
  it("carries the action, the key and the moment it goes", () => {
    expect(
      deletedLine({
        action: "deleted",
        key: "USH-14",
        title: "Write the offline queue tests",
        goesAt: goesAt(AT),
      }),
    ).toEqual({
      action: "deleted",
      key: "USH-14",
      title: "Write the offline queue tests",
      goesAt: new Date(at + 30 * DAY).toISOString(),
    });
  });

  /* A receiver watching `deleted` now hears a put back as well, and has to
     read the action to tell them apart. */
  it("says restored with no moment, because a task that is back has no window", () => {
    expect(
      deletedLine({
        action: "restored",
        key: "USH-14",
        title: "Write the offline queue tests",
        goesAt: null,
      }),
    ).toEqual({
      action: "restored",
      key: "USH-14",
      title: "Write the offline queue tests",
      goesAt: null,
    });
  });
});
