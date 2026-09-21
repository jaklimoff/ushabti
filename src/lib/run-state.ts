import { longAgo } from "./board";
import {
  CLOSED_STATUSES,
  type AgentRunDTO,
  type AgentRunRowDTO,
  type RunStatus,
  type RunStepState,
} from "./types";

/** A run is open until it is done, failed, stopped, taken over or lost. */
export function isOpen(status: RunStatus): boolean {
  return !CLOSED_STATUSES.includes(status);
}

/**
 * The open runs that stopped on purpose.
 *
 * One asked a person a question; one handed the task to somebody else. In
 * both the agent said the last thing it has to say, so silence is the
 * expected answer and never evidence that the process died. The lease leaves
 * these alone, the bar stands still, and Take over is the only button left.
 */
export const WAITING_STATUSES: RunStatus[] = ["waiting", "handed_over"];

export function isWaiting(status: RunStatus | undefined): boolean {
  return status !== undefined && WAITING_STATUSES.includes(status);
}

/**
 * True when the status an agent reports answers what a person asked for.
 * The request stays on the run until then, and the panel says it is waiting
 * for an answer; a report that says something else is not an answer.
 */
export function obeys(control: string | null, status: RunStatus): boolean {
  if (!control) return false;
  if (control === "pause") return status === "paused";
  if (control === "resume") return status === "running";
  if (control === "stop") return CLOSED_STATUSES.includes(status);
  return false;
}

/* ------------------------------------------------------------------ */
/* Is anybody still there?                                             */
/* ------------------------------------------------------------------ */

/**
 * How often an agent beats while it works, when it runs `board.mjs beat`.
 * The beat is optional: an agent that only reports still works, it is only
 * called quiet sooner.
 */
export const BEAT_EVERY_MS = 120_000;

/** Three missed beats. Under this, silence is normal work. */
export const SILENT_AFTER_MS = 3 * BEAT_EVERY_MS;

/**
 * No report for this long and the board closes the run itself.
 *
 * It counts reports, never beats. A beat is a timer, and a timer left behind
 * by a killed session would otherwise hold a card open for ever — which is
 * the very thing this whole idea exists to stop.
 */
export const REPORT_LEASE_MS = 30 * 60_000;

/**
 * The longest a single report may push the next one out.
 *
 * An agent that says "my next word is an hour away" has told a person
 * something they can act on. One that says "a day away" has only turned the
 * lease off, and the lease is the only thing that ever gets a card back.
 */
export const MAX_REPORT_FOR_MS = 60 * 60_000;

/**
 * How long a report buys, when the report says so itself.
 *
 * It only ever stretches. A step that says three minutes is naming when to
 * expect the next word, not asking to be closed sooner than any other run,
 * so anything under the ordinary lease keeps the ordinary lease. Above it,
 * an hour is the most a report can ask for.
 *
 * This is a report and not a beat: an agent says it once, by hand, about the
 * step it is starting. No timer can write it.
 */
export function reportForMs(minutes: number): number {
  const asked = Math.round(minutes * 60_000);
  return Math.min(MAX_REPORT_FOR_MS, Math.max(REPORT_LEASE_MS, asked));
}

/**
 * What the board can honestly say about an open run.
 *
 * - `reporting` — the agent said something recently. The work moves.
 * - `quiet` — it beats but reports nothing. It is alive; the work may not be.
 * - `silent` — nothing at all. Nobody knows if it is there.
 */
export type RunLife = "reporting" | "quiet" | "silent";

export function lifeOf(
  run: Pick<AgentRunDTO, "updatedAt" | "beatAt"> & Partial<Pick<AgentRunDTO, "status">>,
  now: number = Date.now(),
): RunLife {
  // A waiting agent said the last thing it has to say: its question, or the
  // name of whoever has the task now. Nobody expects it to speak again.
  if (isWaiting(run.status)) return "reporting";
  if (now - new Date(run.updatedAt).getTime() < SILENT_AFTER_MS) return "reporting";
  return now - new Date(run.beatAt).getTime() < SILENT_AFTER_MS ? "quiet" : "silent";
}

/** What the lease reads: the last report, and the deadline that report named. */
type RunLease = Pick<AgentRunDTO, "updatedAt"> & Partial<Pick<AgentRunDTO, "reportDueAt">>;

/**
 * The moment the board closes this run, unless the agent speaks again.
 *
 * A run whose last report named how long the next word takes is judged by
 * that moment; every other run by its last report and the ordinary lease.
 * `sweepLost` asks the database the same question, in the same two halves.
 */
export function leaseEndsAt(run: RunLease): number {
  if (run.reportDueAt) return new Date(run.reportDueAt).getTime();
  return new Date(run.updatedAt).getTime() + REPORT_LEASE_MS;
}

/** How long the run has left before the board closes it, in ms. Never below zero. */
export function leaseLeft(run: RunLease, now: number = Date.now()): number {
  return Math.max(0, leaseEndsAt(run) - now);
}

/**
 * An agent reports the step it is on, and everything before that is finished.
 * Keeping the rule here rather than in the route means one place decides what
 * "step 3 of 5" paints.
 */
export function stepStates(count: number, currentIndex: number): RunStepState[] {
  const states: RunStepState[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i < currentIndex) states.push("done");
    else if (i === currentIndex) states.push("active");
    else states.push("todo");
  }
  return states;
}

/** How much of the plan is behind the agent, from 0 to 1. */
export function progressOf(run: Pick<AgentRunDTO, "stepsTotal" | "stepsDone">): number {
  if (run.stepsTotal <= 0) return 0;
  return Math.min(1, Math.max(0, run.stepsDone / run.stepsTotal));
}

/** The one line the card shows. Falls back to the goal, then to a default. */
export function runLine(run: Pick<AgentRunDTO, "step" | "goal" | "status">): string {
  if (run.status === "paused") return run.step.trim() || "Paused";
  // A hand-over keeps who has the task now in the step, because that name is
  // the only thing left to say. The sentence is built here so that the card,
  // the panel and anything else read the same words.
  if (run.status === "handed_over") return `Waiting for ${run.step.trim() || "the next agent"}`;
  if (run.status === "waiting") return run.step.trim() || "Waiting for an answer";
  return run.step.trim() || run.goal.trim() || "Working";
}

/**
 * The one number a run strip has room for, and whether it is a warning.
 *
 * A run that answers shows how long it has worked. One that has gone quiet
 * shows how long ago it last said anything, and one that waits shows how long
 * a person has kept it waiting, because in each case that is the number a
 * person needs.
 */
export function runClock(
  run: Pick<AgentRunDTO, "status" | "startedAt" | "updatedAt" | "beatAt">,
  now: number = Date.now(),
): { text: string; stale: boolean } {
  if (isWaiting(run.status)) return { text: `waiting ${elapsed(run.updatedAt, now)}`, stale: true };
  const life = lifeOf(run, now);
  if (life === "reporting") return { text: elapsed(run.startedAt, now), stale: false };
  return { text: `${LIFE_WORD[life]} ${elapsed(run.updatedAt, now)}`, stale: true };
}

/** Whether the bar under a run should stop: nobody is working on it now. */
export function runIsStill(
  run: Pick<AgentRunDTO, "status" | "updatedAt" | "beatAt">,
  now: number = Date.now(),
): boolean {
  if (run.status === "paused" || isWaiting(run.status)) return true;
  return lifeOf(run, now) === "silent";
}

/** A length of time, the way the design writes it: 45s, 12m, 2h 04m. */
export function duration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** How long ago a moment was. Never counts backwards when two clocks disagree. */
export function elapsed(fromISO: string, now: number = Date.now()): string {
  return duration(now - new Date(fromISO).getTime());
}

export const STATUS_WORD: Record<RunStatus, string> = {
  running: "active",
  paused: "paused",
  waiting: "waiting for an answer",
  handed_over: "handed over",
  done: "finished",
  failed: "failed",
  stopped: "stopped",
  taken_over: "taken over",
  lost: "lost",
};

/**
 * The words of one closed run, in the order a history row reads them:
 * when it started, how long it ran, how it ended.
 *
 * A closed run kept a length, not an age, so the length is worked out from
 * the two moments the run holds and never from the clock. Only "when" moves,
 * and it moves in days rather than in seconds, so no row has to tick.
 *
 * A run with no `endedAt` cannot reach this list, and the fall back to the
 * last report is still the honest answer if one ever does.
 */
export function pastRunWords(
  run: Pick<AgentRunRowDTO, "status" | "startedAt" | "endedAt" | "updatedAt">,
  now: number = Date.now(),
): { when: string; length: string; ended: string } {
  const started = new Date(run.startedAt).getTime();
  const ended = new Date(run.endedAt ?? run.updatedAt).getTime();
  return {
    when: longAgo(run.startedAt, now),
    length: duration(ended - started),
    ended: STATUS_WORD[run.status],
  };
}

/** The word for an open run: what it does, or what nobody has heard from it. */
export const LIFE_WORD: Record<RunLife, string> = {
  reporting: "",
  quiet: "quiet",
  silent: "silent",
};
