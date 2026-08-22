import { describe, expect, it } from "vitest";
import { elapsed, isOpen, progressOf, runLine, stepStates } from "../run-state";

describe("run state", () => {
  it("counts a run as open until it ends", () => {
    expect(isOpen("running")).toBe(true);
    expect(isOpen("paused")).toBe(true);
    expect(isOpen("done")).toBe(false);
    expect(isOpen("failed")).toBe(false);
    expect(isOpen("stopped")).toBe(false);
    expect(isOpen("taken_over")).toBe(false);
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
});
