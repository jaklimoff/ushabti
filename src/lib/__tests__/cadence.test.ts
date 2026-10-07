import { describe, expect, it } from "vitest";
import {
  addDays,
  cadenceEdit,
  firstSprints,
  followOn,
  nextSprintName,
  readCadence,
  readCadenceInput,
  sprintAfter,
} from "../cadence";

describe("the cadence a property carries", () => {
  it("is 14 days when nobody set it", () => {
    expect(readCadence({})).toEqual({ length: 14 });
    expect(readCadence(null)).toEqual({ length: 14 });
  });

  it("reads the length saved, and drops what cannot be one", () => {
    expect(readCadence({ cadence: { length: 7, ahead: 3 } })).toEqual({ length: 7 });
    expect(readCadence({ cadence: { length: 0 } })).toEqual({ length: 14 });
  });
});

describe("a cadence written", () => {
  it("takes a whole number of days in range", () => {
    expect(readCadenceInput({ length: 10 })).toEqual({ patch: { length: 10 } });
    expect(readCadenceInput({})).toEqual({ patch: {} });
  });

  it("refuses a length that is not a whole number in range", () => {
    expect(readCadenceInput({ length: 0 })).toHaveProperty("error");
    expect(readCadenceInput({ length: 1.5 })).toHaveProperty("error");
    expect(readCadenceInput({ length: 400 })).toHaveProperty("error");
  });
});

describe("the next name", () => {
  it("is the trailing number plus one", () => {
    expect(nextSprintName("Sprint 14")).toBe("Sprint 15");
    expect(nextSprintName("Sprint 9")).toBe("Sprint 10");
    expect(nextSprintName("2026.4")).toBe("2026.5");
  });

  it("stays within the 40 characters an option name may have", () => {
    const long = "A".repeat(38) + " 9";
    expect(nextSprintName(long)).toBe("A".repeat(38) + "10");
    expect(nextSprintName("B".repeat(40))).toBe("B".repeat(39) + "2");
    expect(nextSprintName(long)).toHaveLength(40);
  });

  it("gets a 2 when the name has no trailing number", () => {
    expect(nextSprintName("Kickoff")).toBe("Kickoff 2");
  });
});

describe("the dates that follow on", () => {
  it("count whole days across a month and a year", () => {
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("start the day after the previous target, and last the length", () => {
    expect(followOn({ startAt: "2026-10-05", targetAt: "2026-10-18" }, 14, "2026-01-01")).toEqual({
      startAt: "2026-10-19",
      targetAt: "2026-11-01",
    });
  });

  it("with no target, start a length after the start, or today", () => {
    expect(followOn({ startAt: "2026-10-05", targetAt: null }, 7, "2026-01-01").startAt).toBe(
      "2026-10-12",
    );
    expect(followOn({ startAt: null, targetAt: null }, 7, "2026-01-01")).toEqual({
      startAt: "2026-01-01",
      targetAt: "2026-01-07",
    });
  });

  it("never start before today", () => {
    expect(followOn({ startAt: "2026-10-05", targetAt: "2026-10-18" }, 14, "2026-11-07")).toEqual({
      startAt: "2026-11-07",
      targetAt: "2026-11-20",
    });
    expect(followOn({ startAt: "2026-10-05", targetAt: null }, 7, "2026-11-07").startAt).toBe(
      "2026-11-07",
    );
  });
});

describe("set up sprints", () => {
  it("makes the first sprint and the one after it, following on", () => {
    expect(firstSprints("2026-10-05", 14)).toEqual([
      { name: "Sprint 1", startAt: "2026-10-05", targetAt: "2026-10-18" },
      { name: "Sprint 2", startAt: "2026-10-19", targetAt: "2026-11-01" },
    ]);
  });
});

describe("the sprint a ship makes", () => {
  const open = (name: string, startAt: string, targetAt: string) => ({
    id: name,
    name,
    startAt,
    targetAt,
    shippedAt: null as string | null,
  });
  const cadence = { length: 14 };

  it("makes the next one when no open sprint follows", () => {
    const options = [open("Sprint 14", "2026-10-05", "2026-10-18")];
    expect(sprintAfter(options, "Sprint 14", cadence, "2026-10-18")).toEqual({
      name: "Sprint 15",
      startAt: "2026-10-19",
      targetAt: "2026-11-01",
    });
  });

  it("makes nothing when an open sprint follows already", () => {
    const options = [
      open("Sprint 14", "2026-10-05", "2026-10-18"),
      open("Sprint 15", "2026-10-19", "2026-11-01"),
    ];
    expect(sprintAfter(options, "Sprint 14", cadence, "2026-10-18")).toBeNull();
  });

  it("makes one only, after the last option, when the ones after are shipped", () => {
    const options = [
      open("Sprint 14", "2026-10-05", "2026-10-18"),
      { ...open("Sprint 15", "2026-10-19", "2026-11-01"), shippedAt: "2026-10-30" },
    ];
    expect(sprintAfter(options, "Sprint 14", { length: 7 }, "2026-10-18")).toEqual({
      name: "Sprint 16",
      startAt: "2026-11-02",
      targetAt: "2026-11-08",
    });
  });

  it("steps past a name somebody already took by hand", () => {
    const options = [
      open("sprint 15", "2026-09-01", "2026-09-02"),
      open("Sprint 14", "2026-10-05", "2026-10-18"),
    ];
    expect(sprintAfter(options, "Sprint 14", cadence, "2026-10-18")?.name).toBe("Sprint 16");
  });

  it("starts today, and lasts the length, when the ship comes 20 days after the target", () => {
    const options = [open("Sprint 14", "2026-10-05", "2026-10-18")];
    expect(sprintAfter(options, "Sprint 14", cadence, "2026-11-07")).toEqual({
      name: "Sprint 15",
      startAt: "2026-11-07",
      targetAt: "2026-11-20",
    });
  });

  it("starts the day after the target when the ship comes on time", () => {
    const options = [open("Sprint 14", "2026-10-05", "2026-10-18")];
    expect(sprintAfter(options, "Sprint 14", { length: 7 }, "2026-10-18")).toEqual({
      name: "Sprint 15",
      startAt: "2026-10-19",
      targetAt: "2026-10-25",
    });
  });
});

describe("a cadence box", () => {
  it("owes a whole number in range that differs from what is saved", () => {
    expect(cadenceEdit(" 10 ", 14, 365)).toBe(10);
    expect(cadenceEdit("14", 14, 365)).toBeNull();
    expect(cadenceEdit("0", 14, 365)).toBeNull();
    expect(cadenceEdit("1.5", 14, 365)).toBeNull();
    expect(cadenceEdit("", 14, 365)).toBeNull();
    expect(cadenceEdit("11", 1, 10)).toBeNull();
  });
});
