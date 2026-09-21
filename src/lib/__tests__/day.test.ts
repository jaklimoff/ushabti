import { afterEach, describe, expect, it } from "vitest";
import {
  DATE_WINDOWS,
  DEFAULT_TIME_ZONE,
  isDateWindow,
  isTimeZone,
  readTimeZone,
  todayIn,
  windowDays,
  zoneRefused,
  type DateWindow,
} from "../day";
import { matches } from "../filters";
import type { FilterRule, PropertyDTO, TaskDTO } from "../types";

/* 2026-09-21 is a Monday, and 2026-09-27 the Sunday that closes its week. */
const MONDAY = "2026-09-21";
const SUNDAY = "2026-09-27";

describe("the day it is in a zone", () => {
  /*
   * The reason the zone is the project's and not the reader's: one instant is
   * two different days, so two people looking at one view would see two
   * boards if each read their own clock.
   */
  it("gives two days for one moment in two zones", () => {
    const moment = new Date("2026-09-21T23:00:00.000Z");
    expect(todayIn("UTC", moment)).toBe("2026-09-21");
    expect(todayIn("Pacific/Auckland", moment)).toBe("2026-09-22");
  });

  it("gives the day before in a zone behind", () => {
    const moment = new Date("2026-09-21T02:00:00.000Z");
    expect(todayIn("UTC", moment)).toBe("2026-09-21");
    expect(todayIn("America/Los_Angeles", moment)).toBe("2026-09-20");
  });

  it("writes the parts in one order, whatever the locale would say", () => {
    expect(todayIn("Europe/Berlin", new Date("2026-01-05T12:00:00.000Z"))).toBe("2026-01-05");
  });
});

describe("the zone of a project", () => {
  it("knows a place and UTC", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true);
    expect(isTimeZone(DEFAULT_TIME_ZONE)).toBe(true);
  });

  it("does not know a name nobody has", () => {
    expect(isTimeZone("Europe/Atlantis")).toBe(false);
    expect(zoneRefused("Europe/Atlantis")).toContain("Europe/Atlantis");
  });

  /* Read afresh, never cleaned up: a board that cannot say which day it is
     draws nothing at all, so a name this runtime lost falls back. */
  it("falls back to UTC for anything it cannot read", () => {
    expect(readTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(readTimeZone("Europe/Atlantis")).toBe(DEFAULT_TIME_ZONE);
    expect(readTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(readTimeZone(7)).toBe(DEFAULT_TIME_ZONE);
  });
});

describe("the words a window is made of", () => {
  it("is a closed list", () => {
    expect(isDateWindow("this_week")).toBe(true);
    expect(isDateWindow("this_quarter")).toBe(false);
    expect(isDateWindow(null)).toBe(false);
  });

  it("answers every word on the list", () => {
    for (const word of DATE_WINDOWS) expect(windowDays(word, MONDAY)).not.toBeNull();
  });

  it("answers nothing for a day that is not one", () => {
    expect(windowDays("today", "not a day")).toBeNull();
    expect(windowDays("today", "2026-13-40")).toBeNull();
  });
});

describe("the days a window covers, from a Monday", () => {
  const days = (word: DateWindow) => windowDays(word, MONDAY);

  it("today and tomorrow are one day each", () => {
    expect(days("today")).toEqual({ from: "2026-09-21", to: "2026-09-21" });
    expect(days("tomorrow")).toEqual({ from: "2026-09-22", to: "2026-09-22" });
  });

  it("a week runs Monday to Sunday", () => {
    expect(days("this_week")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(days("next_week")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("the last days end today and the next days start today", () => {
    expect(days("last_7")).toEqual({ from: "2026-09-15", to: "2026-09-21" });
    expect(days("last_30")).toEqual({ from: "2026-08-23", to: "2026-09-21" });
    expect(days("next_7")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(days("next_30")).toEqual({ from: "2026-09-21", to: "2026-10-20" });
  });

  it("overdue is before today and has no start", () => {
    expect(days("overdue")).toEqual({ from: null, to: "2026-09-20" });
  });
});

/*
 * The week starts on Monday, written out and never asked of a locale. A
 * Sunday is the end of the week it is in, not the start of the next one.
 */
describe("the days a window covers, from a Sunday", () => {
  it("keeps the Sunday in the week that started on Monday", () => {
    expect(windowDays("this_week", SUNDAY)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(windowDays("next_week", SUNDAY)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("steps over the turn of a month and a year", () => {
    expect(windowDays("this_week", "2027-01-01")).toEqual({
      from: "2026-12-28",
      to: "2027-01-03",
    });
    expect(windowDays("tomorrow", "2026-12-31")).toEqual({
      from: "2027-01-01",
      to: "2027-01-01",
    });
  });

  it("counts the extra day of a leap year", () => {
    expect(windowDays("tomorrow", "2028-02-28")).toEqual({
      from: "2028-02-29",
      to: "2028-02-29",
    });
  });
});

/* ------------------------------------------------------------------ */
/* The same answer wherever the process runs                           */
/* ------------------------------------------------------------------ */

const due: PropertyDTO = {
  id: "p-due",
  name: "Due",
  type: "date",
  position: "V",
  config: {},
  options: [],
};

function task(value: string): TaskDTO {
  return {
    id: "t",
    number: 1,
    key: "USH-1",
    title: "t",
    description: "",
    position: "V",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    values: { "p-due": value },
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    blockedBy: [],
  };
}

describe("a window is read the same wherever the process runs", () => {
  const was = process.env.TZ;
  afterEach(() => {
    process.env.TZ = was;
  });

  /*
   * This is the fault the whole design exists to stop. The board is drawn on
   * the server and again in the browser, and the two machines are rarely in
   * one zone. Given the same day, the same rule has to keep the same cards.
   */
  it("keeps the same cards under four zones", () => {
    const rule: FilterRule = { propertyId: due.id, op: "within", text: "this_week" };
    for (const zone of ["UTC", "Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata"]) {
      process.env.TZ = zone;
      expect(matches(task("2026-09-27"), rule, due, MONDAY)).toBe(true);
      expect(matches(task("2026-09-28"), rule, due, MONDAY)).toBe(false);
      expect(matches(task("2026-09-20"), rule, due, MONDAY)).toBe(false);
    }
  });
});
