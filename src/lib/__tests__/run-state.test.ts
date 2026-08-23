import { describe, expect, it } from "vitest";
import {
  duration,
  elapsed,
  isOpen,
  leaseLeft,
  lifeOf,
  progressOf,
  REPORT_LEASE_MS,
  runLine,
  SILENT_AFTER_MS,
  stepStates,
} from "../run-state";

describe("run state", () => {
  it("counts a run as open until it ends", () => {
    expect(isOpen("running")).toBe(true);
    expect(isOpen("paused")).toBe(true);
    expect(isOpen("done")).toBe(false);
    expect(isOpen("failed")).toBe(false);
    expect(isOpen("stopped")).toBe(false);
    expect(isOpen("taken_over")).toBe(false);
    expect(isOpen("lost")).toBe(false);
  });
});

describe("is anybody still there", () => {
  const now = new Date("2026-08-22T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const fresh = ago(0);

  it("says the agent reports while the reports keep coming", () => {
    expect(lifeOf({ updatedAt: fresh, beatAt: fresh }, now)).toBe("reporting");
    expect(lifeOf({ updatedAt: ago(SILENT_AFTER_MS - 1000), beatAt: ago(60_000) }, now)).toBe(
      "reporting",
    );
  });

  it("says quiet when it beats but reports nothing", () => {
    expect(lifeOf({ updatedAt: ago(20 * 60_000), beatAt: ago(30_000) }, now)).toBe("quiet");
  });

  it("says silent when nothing arrives at all", () => {
    expect(lifeOf({ updatedAt: ago(20 * 60_000), beatAt: ago(20 * 60_000) }, now)).toBe("silent");
  });

  // The whole reason the two columns are apart. A heartbeat left running by a
  // killed session must not be able to make the board say the work moves.
  it("never lets a beat pass for a report", () => {
    const beating = { updatedAt: ago(29 * 60_000), beatAt: fresh };
    expect(lifeOf(beating, now)).toBe("quiet");
    expect(leaseLeft(beating, now)).toBe(REPORT_LEASE_MS - 29 * 60_000);
  });

  it("counts the lease from the last report, and never below zero", () => {
    expect(leaseLeft({ updatedAt: fresh }, now)).toBe(REPORT_LEASE_MS);
    expect(leaseLeft({ updatedAt: ago(REPORT_LEASE_MS + 60_000) }, now)).toBe(0);
  });
});

describe("the plan", () => {
  it("marks everything before the current step done", () => {
    expect(stepStates(5, 2)).toEqual(["done", "done", "active", "todo", "todo"]);
  });

  it("has nothing done on the first step", () => {
    expect(stepStates(3, 0)).toEqual(["active", "todo", "todo"]);
  });

  it("has nothing active once the index passes the end", () => {
    expect(stepStates(2, 2)).toEqual(["done", "done"]);
  });

  it("reports progress between zero and one", () => {
    expect(progressOf({ stepsTotal: 4, stepsDone: 1 })).toBe(0.25);
    expect(progressOf({ stepsTotal: 0, stepsDone: 0 })).toBe(0);
    // A plan that shrank under a step count that did not.
    expect(progressOf({ stepsTotal: 2, stepsDone: 5 })).toBe(1);
  });
});

describe("the line on the card", () => {
  it("says what the agent reported", () => {
    expect(runLine({ step: "Writing tests", goal: "Ship it", status: "running" })).toBe(
      "Writing tests",
    );
  });

  it("falls back to the goal, then to a word", () => {
    expect(runLine({ step: "  ", goal: "Ship it", status: "running" })).toBe("Ship it");
    expect(runLine({ step: "", goal: "", status: "running" })).toBe("Working");
  });

  it("says paused when a paused run reported nothing", () => {
    expect(runLine({ step: "", goal: "Ship it", status: "paused" })).toBe("Paused");
  });
});

describe("elapsed time", () => {
  const now = new Date("2026-08-22T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("writes seconds, then minutes, then hours", () => {
    expect(elapsed(ago(45_000), now)).toBe("45s");
    expect(elapsed(ago(12 * 60_000), now)).toBe("12m");
    expect(elapsed(ago(2 * 3_600_000 + 4 * 60_000), now)).toBe("2h 04m");
  });

  it("never counts backwards when two clocks disagree", () => {
    expect(elapsed(new Date(now + 5_000).toISOString(), now)).toBe("0s");
  });

  it("writes a length of time the same way", () => {
    expect(duration(45_000)).toBe("45s");
    expect(duration(16 * 60_000)).toBe("16m");
    expect(duration(-5)).toBe("0s");
  });
});
