import { CLOSED_STATUSES, type AgentRunDTO, type RunStatus, type RunStepState } from "./types";

/** A run is open until it is done, failed, stopped, taken over or lost. */
export function isOpen(status: RunStatus): boolean {
  return !CLOSED_STATUSES.includes(status);
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
 * What the board can honestly say about an open run.
 *
 * - `reporting` — the agent said something recently. The work moves.
 * - `quiet` — it beats but reports nothing. It is alive; the work may not be.
 * - `silent` — nothing at all. Nobody knows if it is there.
 */
export type RunLife = "reporting" | "quiet" | "silent";

export function lifeOf(
  run: Pick<AgentRunDTO, "updatedAt" | "beatAt">,
  now: number = Date.now(),
): RunLife {
  if (now - new Date(run.updatedAt).getTime() < SILENT_AFTER_MS) return "reporting";
  return now - new Date(run.beatAt).getTime() < SILENT_AFTER_MS ? "quiet" : "silent";
}

/** How long the run has left before the board closes it, in ms. Never below zero. */
export function leaseLeft(run: Pick<AgentRunDTO, "updatedAt">, now: number = Date.now()): number {
  const left = new Date(run.updatedAt).getTime() + REPORT_LEASE_MS - now;
  return Math.max(0, left);
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
  return run.step.trim() || run.goal.trim() || "Working";
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
  done: "finished",
  failed: "failed",
  stopped: "stopped",
  taken_over: "taken over",
  lost: "lost",
};

/** The word for an open run: what it does, or what nobody has heard from it. */
export const LIFE_WORD: Record<RunLife, string> = {
  reporting: "",
  quiet: "quiet",
  silent: "silent",
};
