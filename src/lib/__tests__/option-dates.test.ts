import { describe, expect, it } from "vitest";
import {
  carriesDates,
  datesClash,
  isoDay,
  namesOptionDates,
  isOpenOption,
  optionEdit,
  pickableOptions,
  readOptionDates,
  splitShipped,
} from "../option-dates";

describe("isoDay", () => {
  it("reads a day and the day of a date-time", () => {
    expect(isoDay("2026-10-03")).toBe("2026-10-03");
    expect(isoDay("2026-10-03T12:30:00Z")).toBe("2026-10-03");
  });

  it("refuses what names no real day", () => {
    expect(isoDay("2026-02-30")).toBeNull();
    expect(isoDay("next friday")).toBeNull();
    expect(isoDay("03/10/2026")).toBeNull();
    expect(isoDay("2026-10-03Tnonsense")).toBeNull();
  });
});

describe("readOptionDates", () => {
  it("leaves an absent field alone and clears a null one", () => {
    expect(readOptionDates({ startAt: "2026-10-01", targetAt: null })).toEqual({
      patch: { startAt: "2026-10-01", targetAt: null },
    });
    expect(readOptionDates({})).toEqual({ patch: {} });
  });

  it("refuses a date that does not parse, with a sentence", () => {
    expect(readOptionDates({ targetAt: "soon" })).toEqual({
      error: "The target date must be a date like 2026-10-03.",
    });
    expect(readOptionDates({ shippedAt: 20261003 })).toEqual({
      error: "The shipped date must be a date like 2026-10-03.",
    });
  });

  it("trims a note and keeps an empty one as nothing", () => {
    expect(readOptionDates({ note: "  ships the **API** " })).toEqual({
      patch: { note: "ships the **API**" },
    });
    expect(readOptionDates({ note: "   " })).toEqual({ patch: { note: null } });
    expect(readOptionDates({ note: 4 })).toEqual({ error: "The note must be text." });
    expect("error" in readOptionDates({ note: "x".repeat(2001) })).toBe(true);
  });
});

describe("datesClash", () => {
  it("refuses a target before the start", () => {
    expect(datesClash({ startAt: "2026-10-10", targetAt: "2026-10-01" })).toBe(
      "The target date cannot be before the start date.",
    );
  });

  it("lets a target on or after the start, or either alone, stand", () => {
    expect(datesClash({ startAt: "2026-10-01", targetAt: "2026-10-01" })).toBeNull();
    expect(datesClash({ startAt: null, targetAt: "2026-10-01" })).toBeNull();
    expect(datesClash({ startAt: "2026-10-01", targetAt: null })).toBeNull();
  });
});

describe("namesOptionDates", () => {
  it("is true when a body names any of the four", () => {
    expect(namesOptionDates({ name: "v2" })).toBe(false);
    expect(namesOptionDates({ note: null })).toBe(true);
  });
});

describe("optionEdit", () => {
  it("owes nothing while the box holds what is saved", () => {
    expect(optionEdit("2026-10-03", "2026-10-03")).toBeUndefined();
    expect(optionEdit("", null)).toBeUndefined();
    expect(optionEdit(" note ", "note")).toBeUndefined();
  });

  it("owes the new words, or null when the box was emptied", () => {
    expect(optionEdit("2026-10-04", "2026-10-03")).toBe("2026-10-04");
    expect(optionEdit("", "2026-10-03")).toBeNull();
    expect(optionEdit("first", null)).toBe("first");
  });
});

describe("carriesDates", () => {
  it("is true for an iteration with no switch, and for a select only when switched on", () => {
    expect(carriesDates({ type: "iteration", config: {} })).toBe(true);
    expect(carriesDates({ type: "iteration", config: null })).toBe(true);
    expect(carriesDates({ type: "select", config: {} })).toBe(false);
    expect(carriesDates({ type: "select", config: { dated: true } })).toBe(true);
    expect(carriesDates({ type: "multi_select", config: { dated: true } })).toBe(false);
  });
});

describe("isOpenOption", () => {
  const shipped = { id: "s14", shippedAt: "2026-09-01" };
  const open = { id: "s15", shippedAt: null };

  it("closes a shipped option of an iteration, and nothing else", () => {
    expect(isOpenOption({ type: "iteration" }, shipped)).toBe(false);
    expect(isOpenOption({ type: "iteration" }, open)).toBe(true);
    // A version that shipped stays where it is: people pick old ones on purpose.
    expect(isOpenOption({ type: "select" }, shipped)).toBe(true);
  });

  it("offers the open options, plus the one a value already holds", () => {
    const sprint = { type: "iteration", options: [shipped, open] };
    expect(pickableOptions(sprint, null).map((o) => o.id)).toEqual(["s15"]);
    expect(pickableOptions(sprint, "s14").map((o) => o.id)).toEqual(["s14", "s15"]);
    const version = { type: "select", options: [shipped, open] };
    expect(pickableOptions(version, null).map((o) => o.id)).toEqual(["s14", "s15"]);
  });

  it("splits the shipped ones off for a fold, in their order", () => {
    const old = { id: "s13", shippedAt: "2026-08-01" };
    const sprint = { type: "iteration", options: [old, shipped, open] };
    const split = splitShipped(sprint);
    expect(split.open.map((o) => o.id)).toEqual(["s15"]);
    expect(split.shipped.map((o) => o.id)).toEqual(["s13", "s14"]);
    expect(splitShipped({ type: "select", options: [shipped, open] }).shipped).toEqual([]);
  });
});
