import { CLOSED_STATUSES, type AgentRunDTO, type RunStatus, type RunStepState } from "./types";

/** A run is open until it is done, failed, stopped or taken over. */
export function isOpen(status: RunStatus): boolean {
  return !CLOSED_STATUSES.includes(status);
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

/** Short elapsed time, the way the design writes it: 45s, 12m, 2h 04m. */
export function elapsed(fromISO: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(fromISO).getTime());
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export const STATUS_WORD: Record<RunStatus, string> = {
  running: "active",
  paused: "paused",
  done: "finished",
  failed: "failed",
  stopped: "stopped",
  taken_over: "taken over",
};
