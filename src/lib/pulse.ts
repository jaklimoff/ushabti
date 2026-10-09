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

export type AgentsAtWork = { working: number; silent: number };

export type LastChange = { at: string; who: string | null; taskKey: string | null };

export type ProjectPulse = {
  /** The main view, so the browser can read what this person folded on it. */
  viewId: string | null;
  /** Null when the main view draws no columns: a list, a roadmap, or no grouping. */
  columns: PulseColumn[] | null;
  agents: AgentsAtWork;
  last: LastChange | null;
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
  const heard = new Map<string, boolean>();
  for (const run of runs) {
    if (isWaiting(run.status)) continue;
    const alive = lifeOf(run, now) !== "silent";
    heard.set(run.agent.id, (heard.get(run.agent.id) ?? false) || alive);
  }
  let silent = 0;
  for (const alive of heard.values()) if (!alive) silent += 1;
  return { working: heard.size, silent };
}

/** "3 agents working, 1 silent", or null when nobody works. */
export function agentsLine({ working, silent }: AgentsAtWork): string | null {
  if (working === 0) return null;
  const head = `${working} ${working === 1 ? "agent" : "agents"} working`;
  return silent > 0 ? `${head}, ${silent} silent` : head;
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
