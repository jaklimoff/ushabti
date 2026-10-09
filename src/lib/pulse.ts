import { buildColumns } from "./board";
import { allowedColumns, applyFilters, mergeFilters, waitingTasks } from "./filters";
import { isWaiting, lifeOf } from "./run-state";
import type { AgentRunRowDTO, BoardData } from "./types";

/**
 * How one project is going, as its card on the project list reads it.
 *
 * Every count here is the board's own answer: the main view's columns, put
 * together by the readers the board itself draws with. A rule written again
 * for this page would sooner or later count a card the board hides.
 */

export type PulseColumn = { id: string; name: string; color: string; count: number };

/** The names of the agents that report, in the order their runs came. */
export type AgentsAtWork = { names: string[]; silent: number };

export type LastChange = { at: string; who: string | null; taskKey: string | null };

/** Somebody on the project, as the card's footer draws them. */
export type PulsePerson = { id: string; name: string; kind: "human" | "agent" };

/** Three weeks with nothing written, and a card reads quiet. */
export const QUIET_AFTER = 21 * 24 * 60 * 60 * 1000;

export type ProjectPulse = {
  /** The main view, so the browser can read what this person folded on it. */
  viewId: string | null;
  /** Null when the main view draws no columns: a list, a roadmap, or no grouping. */
  columns: PulseColumn[] | null;
  agents: AgentsAtWork;
  last: LastChange | null;
  people: PulsePerson[];
  /** No change for three weeks. Worked out where the page is drawn, so it hydrates. */
  quiet: boolean;
};

type BoardPart = Pick<
  BoardData,
  "project" | "today" | "members" | "former" | "properties" | "views" | "tasks" | "runs"
>;

/**
 * The columns of the main view, with the cards this person would see in each.
 *
 * The main view is the one a board opens on when nobody picked one. Only a
 * board answers: a list or a roadmap has no columns to share out, and falling
 * back to another view would count a board the person does not open.
 */
export function mainColumns(board: BoardPart, viewer: string | null): PulseColumn[] | null {
  const view = board.views.find((v) => v.isDefault) ?? board.views[0];
  if (!view || view.kind !== "board" || !view.groupById) return null;
  const property = board.properties.find((p) => p.id === view.groupById);
  if (!property) return null;

  const filters = mergeFilters(view.filters, view.lens);
  const visible = applyFilters(
    board.tasks,
    filters,
    board.properties,
    board.today,
    viewer,
    waitingTasks(board.runs),
    board.project.timeZone,
  );
  return allowedColumns(
    buildColumns(property, visible, board.members, board.former),
    filters,
    property,
    board.today,
    viewer,
  ).map((c) => ({ id: c.id, name: c.name, color: c.color, count: c.tasks.length }));
}

/**
 * The agents with an open run that is not waiting, and how many of those
 * nobody has heard from. An agent counts once however many runs it holds, and
 * it is silent only when every one of them is: one run that reports says the
 * agent is there.
 */
export function agentsAtWork(
  runs: Pick<AgentRunRowDTO, "status" | "updatedAt" | "beatAt" | "agent">[],
  now: number = Date.now(),
): AgentsAtWork {
  const heard = new Map<string, { name: string; alive: boolean }>();
  for (const run of runs) {
    if (isWaiting(run.status)) continue;
    const alive = lifeOf(run, now) !== "silent";
    const seen = heard.get(run.agent.id);
    heard.set(run.agent.id, { name: run.agent.name, alive: (seen?.alive ?? false) || alive });
  }
  const all = [...heard.values()];
  return {
    names: all.filter((a) => a.alive).map((a) => a.name),
    silent: all.filter((a) => !a.alive).length,
  };
}

/**
 * "Builder working", "Builder and Scout working", "Builder and 2 more
 * working", or null when no agent reports. A silent agent is not at work, so
 * the card shows the last change instead.
 */
export function agentsLine({ names }: AgentsAtWork): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} working`;
  if (names.length === 2) return `${names[0]} and ${names[1]} working`;
  return `${names[0]} and ${names.length - 1} more working`;
}

export function isQuiet(last: LastChange | null, now: number): boolean {
  return last !== null && now - Date.parse(last.at) > QUIET_AFTER;
}

/**
 * The columns the bar draws and the ones that step aside. A folded column is
 * the person saying "not this pile", so it leaves the bar and reads last.
 */
export function splitFolded(
  columns: PulseColumn[],
  folded: readonly string[],
): { open: PulseColumn[]; aside: PulseColumn[] } {
  return {
    open: columns.filter((c) => !folded.includes(c.id)),
    aside: columns.filter((c) => folded.includes(c.id)),
  };
}
