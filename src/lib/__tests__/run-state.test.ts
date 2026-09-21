import { describe, expect, it } from "vitest";
import {
  duration,
  elapsed,
  isOpen,
  isWaiting,
  leaseEndsAt,
  leaseLeft,
  lifeOf,
  MAX_REPORT_FOR_MS,
  obeys,
  pastRunWords,
  progressOf,
  REPORT_LEASE_MS,
  reportForMs,
  runClock,
  runIsStill,
  runLine,
  SILENT_AFTER_MS,
  stepStates,
} from "../run-state";

describe("run state", () => {
  it("counts a run as open until it ends", () => {
    expect(isOpen("running")).toBe(true);
    expect(isOpen("paused")).toBe(true);
    expect(isOpen("waiting")).toBe(true);
    expect(isOpen("handed_over")).toBe(true);
    expect(isOpen("done")).toBe(false);
    expect(isOpen("failed")).toBe(false);
    expect(isOpen("stopped")).toBe(false);
    expect(isOpen("taken_over")).toBe(false);
    expect(isOpen("lost")).toBe(false);
  });
});

describe("obeying a control word", () => {
  it("clears a pause only when the agent says it paused", () => {
    expect(obeys("pause", "paused")).toBe(true);
    expect(obeys("pause", "running")).toBe(false);
    expect(obeys("pause", "waiting")).toBe(false);
  });

  it("clears a resume only when the agent says it runs again", () => {
    expect(obeys("resume", "running")).toBe(true);
    expect(obeys("resume", "paused")).toBe(false);
  });

  it("clears a stop with any closed status", () => {
    expect(obeys("stop", "stopped")).toBe(true);
    expect(obeys("stop", "done")).toBe(true);
    expect(obeys("stop", "failed")).toBe(true);
    expect(obeys("stop", "running")).toBe(false);
    expect(obeys("stop", "paused")).toBe(false);
  });

  it("has nothing to clear when nobody asked", () => {
    expect(obeys(null, "paused")).toBe(false);
    expect(obeys(null, "stopped")).toBe(false);
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

describe("a report that says how long the next one takes", () => {
  const now = new Date("2026-09-21T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const ahead = (ms: number) => new Date(now + ms).toISOString();

  it("holds the run open past the ordinary lease", () => {
    const long = { updatedAt: ago(40 * 60_000), reportDueAt: ahead(5 * 60_000) };
    // Forty minutes without a word, and the run is still alive, because the
    // last word said the next one was forty-five minutes away.
    expect(leaseLeft(long, now)).toBe(5 * 60_000);
    expect(leaseEndsAt(long)).toBe(now + 5 * 60_000);
  });

  it("closes the run once the moment it named is past", () => {
    expect(leaseLeft({ updatedAt: ago(70 * 60_000), reportDueAt: ago(60_000) }, now)).toBe(0);
  });

  it("falls back to the last report when no report named a moment", () => {
    expect(leaseLeft({ updatedAt: ago(10 * 60_000), reportDueAt: null }, now)).toBe(
      REPORT_LEASE_MS - 10 * 60_000,
    );
  });

  // A beat writes `beat_at` and nothing else, so it can reach neither half of
  // the lease. This is the rule the whole feature had to keep.
  it("never lets a beat hold a run open", () => {
    const beating = { updatedAt: ago(REPORT_LEASE_MS + 60_000), beatAt: ago(0), reportDueAt: null };
    expect(leaseLeft(beating, now)).toBe(0);
    expect(lifeOf(beating, now)).toBe("quiet");
  });

  it("grants at most an hour, whatever is asked for", () => {
    expect(reportForMs(45)).toBe(45 * 60_000);
    expect(reportForMs(60)).toBe(MAX_REPORT_FOR_MS);
    expect(reportForMs(90)).toBe(MAX_REPORT_FOR_MS);
    expect(reportForMs(60 * 24)).toBe(MAX_REPORT_FOR_MS);
  });

  // Naming a short step is telling the board when to expect the next word. It
  // is not asking to be closed sooner than every other run.
  it("keeps the ordinary lease for anything under it", () => {
    expect(reportForMs(3)).toBe(REPORT_LEASE_MS);
    expect(reportForMs(30)).toBe(REPORT_LEASE_MS);
    expect(reportForMs(31)).toBe(31 * 60_000);
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

describe("a run that waits for a person", () => {
  const now = new Date("2026-08-22T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const run = {
    status: "waiting" as const,
    step: "Which service owns the queue?",
    goal: "Refine the task",
    startedAt: ago(3 * 3_600_000),
    updatedAt: ago(2 * 3_600_000),
    beatAt: ago(2 * 3_600_000),
  };

  it("is never called silent, however long the person takes", () => {
    expect(lifeOf(run, now)).toBe("reporting");
  });

  it("shows its question, and how long it has waited", () => {
    expect(runLine(run)).toBe("Which service owns the queue?");
    expect(runLine({ ...run, step: " " })).toBe("Waiting for an answer");
    expect(runClock(run, now)).toEqual({ text: "waiting 2h 00m", stale: true });
  });

  it("holds its bar still, because nothing is working", () => {
    expect(runIsStill(run, now)).toBe(true);
  });
});

describe("a run that handed the task on", () => {
  const now = new Date("2026-08-22T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const run = {
    status: "handed_over" as const,
    // The step is who has the task now, and nothing else.
    step: "review",
    goal: "Write the queue tests",
    startedAt: ago(3 * 3_600_000),
    updatedAt: ago(2 * 3_600_000),
    beatAt: ago(2 * 3_600_000),
  };

  it("waits on purpose, exactly as a question does", () => {
    expect(isWaiting("handed_over")).toBe(true);
    expect(isWaiting("waiting")).toBe(true);
    expect(isWaiting("running")).toBe(false);
    expect(isWaiting(undefined)).toBe(false);
  });

  it("is never called silent, however long the next agent takes", () => {
    expect(lifeOf(run, now)).toBe("reporting");
  });

  it("names whoever has the task, and says how long it has waited", () => {
    expect(runLine(run)).toBe("Waiting for review");
    expect(runLine({ ...run, step: " " })).toBe("Waiting for the next agent");
    expect(runClock(run, now)).toEqual({ text: "waiting 2h 00m", stale: true });
  });

  it("holds its bar still, because nothing is working", () => {
    expect(runIsStill(run, now)).toBe(true);
  });

  it("reads 'handed over' once it is a row of the history", () => {
    const ended = { ...run, endedAt: ago(3_600_000) };
    expect(pastRunWords(ended, now).ended).toBe("handed over");
  });
});

describe("the one number on a run strip", () => {
  const now = new Date("2026-08-22T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const base = { status: "running" as const, startedAt: ago(12 * 60_000) };

  it("counts the work while the agent reports", () => {
    const run = { ...base, updatedAt: ago(10_000), beatAt: ago(10_000) };
    expect(runClock(run, now)).toEqual({ text: "12m", stale: false });
    expect(runIsStill(run, now)).toBe(false);
  });

  it("counts the silence once the agent stops", () => {
    const run = { ...base, updatedAt: ago(9 * 60_000), beatAt: ago(9 * 60_000) };
    expect(runClock(run, now)).toEqual({ text: "silent 9m", stale: true });
    expect(runIsStill(run, now)).toBe(true);
  });
});

describe("the words of a run that is over", () => {
  const now = new Date("2026-08-22T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const day = 24 * 60 * 60_000;

  const run = {
    status: "done" as const,
    startedAt: ago(2 * day),
    endedAt: ago(2 * day - 14 * 60_000),
    updatedAt: ago(2 * day - 14 * 60_000),
  };

  it("says when it started, how long it ran and how it ended", () => {
    expect(pastRunWords(run, now)).toEqual({
      when: "2 days ago",
      length: "14m",
      ended: "finished",
    });
  });

  it("keeps the length it had, however long ago that was", () => {
    const older = { ...run, startedAt: ago(40 * day), endedAt: ago(40 * day - 14 * 60_000) };
    expect(pastRunWords(older, now).length).toBe("14m");
    expect(pastRunWords(older, now).when).toBe("1 month ago");
  });

  it("gives every ending its own word", () => {
    const wordOf = (status: typeof run.status | "failed" | "stopped" | "taken_over" | "lost") =>
      pastRunWords({ ...run, status: status as typeof run.status }, now).ended;
    expect(wordOf("failed")).toBe("failed");
    expect(wordOf("stopped")).toBe("stopped");
    expect(wordOf("taken_over")).toBe("taken over");
    expect(wordOf("lost")).toBe("lost");
  });

  it("falls back to the last report when a run holds no end", () => {
    const odd = { ...run, endedAt: null };
    expect(pastRunWords(odd, now).length).toBe("14m");
  });
});
