import { buildColumns } from "./board";
import { chartDays, type ChartDay } from "./charts";
import { allowedColumns, applyFilters, currentOption, mergeFilters, waitingTasks } from "./filters";
import { progressOf } from "./progress";
import { dayNumber } from "./roadmap";
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

/** The newest line of the feed, with what the card's sentence needs of it. */
export type LastChange = {
  at: string;
  who: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  kind: string;
  /** The property a value line changed, and the value it says it took. */
  propertyId: string | null;
  value: string | null;
};

/**
 * Where the project is heading, as the card's second row reads it: the
 * current release, else the current sprint, else the newest change.
 */
export type Heading =
  | {
      kind: "release" | "sprint";
      /** The property's own name, so a select called Version reads Version. */
      property: string;
      name: string;
      /** The day it ends, as YYYY-MM-DD. */
      day: string;
      /** Days from today to that day; below zero once it is past. */
      left: number;
      done: number;
      total: number;
    }
  | {
      kind: "change";
      who: string;
      verb: string;
      taskKey: string | null;
      taskTitle: string | null;
      /** The column a move took the task to, or null when it was no move. */
      to: string | null;
    };

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
  heading: Heading | null;
  people: PulsePerson[];
  /** No change for three weeks. Worked out where the page is drawn, so it hydrates. */
  quiet: boolean;
  /** Lines of the feed on each of the last fourteen days in the project's zone, today last. */
  days: number[];
};

/** How far back the card's row of bars reaches. */
export const PULSE_DAYS = 14;

/**
 * The fourteen counts the card draws, oldest first. The rows are already cut
 * by the day in the project's zone, and `today` is the board's own, so the
 * last bar is the day the people of the project call today.
 */
export function pulseDays(rows: ChartDay[], today: string): number[] {
  return chartDays(rows, today, PULSE_DAYS).map((d) => d.count);
}

/**
 * How long a project with nothing in the bars has been quiet: "3 weeks",
 * "2 months". In weeks first, because the bars already cover two of them.
 */
export function quietFor(at: string, now: number): string {
  const days = Math.max(0, Math.floor((now - Date.parse(at)) / 86_400_000));
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (days < 7) return count(days, "day");
  if (days < 60) return count(Math.floor(days / 7), "week");
  if (days < 365) return count(Math.floor(days / 30), "month");
  return count(Math.floor(days / 365), "year");
}

/**
 * What the bars say to somebody who cannot see them: the total, and the
 * busiest day with how far back it was. The newest of two equal days wins.
 */
export function pulseLabel(days: number[]): string {
  const total = days.reduce((sum, n) => sum + n, 0);
  const said = `${total} ${total === 1 ? "change" : "changes"} in ${days.length} days`;
  if (total === 0) return said;
  let busiest = days.length - 1;
  for (let i = days.length - 1; i >= 0; i--) if (days[i] > days[busiest]) busiest = i;
  const back = days.length - 1 - busiest;
  const when = back === 0 ? "today" : back === 1 ? "yesterday" : `${back} days ago`;
  return `${said}. The busiest day was ${when}, with ${days[busiest]}.`;
}

type BoardPart = Pick<
  BoardData,
  "project" | "today" | "members" | "former" | "properties" | "views" | "tasks" | "runs"
>;

/** The view a board opens on when nobody picked one. */
function mainView(board: Pick<BoardData, "views">) {
  return board.views.find((v) => v.isDefault) ?? board.views[0];
}

/**
 * The columns of the main view, with the cards this person would see in each.
 *
 * The main view is the one a board opens on when nobody picked one. Only a
 * board answers: a list or a roadmap has no columns to share out, and falling
 * back to another view would count a board the person does not open.
 */
export function mainColumns(board: BoardPart, viewer: string | null): PulseColumn[] | null {
  const view = mainView(board);
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

/**
 * The second row of the card. "Are releases on?" asks the pointer and never a
 * name, as the board does. The numbers are the column header's own, over every
 * live task in the option, because the card shows no filter to explain fewer.
 * Releases on with nothing current falls through, so the row still says
 * something on a project that has had work.
 */
export function headingOf(
  board: Pick<BoardData, "project" | "today" | "properties" | "views" | "tasks">,
  last: LastChange | null,
): Heading | null {
  for (const [kind, id] of [
    ["release", board.project.releaseBy],
    ["sprint", board.project.sprintBy],
  ] as const) {
    const property = id ? board.properties.find((p) => p.id === id) : undefined;
    if (!property) continue;
    const option = property.options.find((o) => o.id === currentOption(property, board.today));
    if (!option?.targetAt) continue;
    const { done, total } = progressOf(
      board.tasks.filter((t) => t.values[property.id] === option.id),
      board.project.doneWhen,
      board.project.progressBy,
    );
    return {
      kind,
      property: property.name,
      name: option.name,
      day: option.targetAt,
      left: dayNumber(option.targetAt) - dayNumber(board.today),
      done,
      total,
    };
  }
  if (!last) return null;
  const view = mainView(board);
  const moved =
    last.kind === "value" &&
    !!last.propertyId &&
    view?.kind === "board" &&
    view.groupById === last.propertyId;
  return {
    kind: "change",
    who: last.who ?? "Somebody",
    verb: moved ? "moved" : (VERBS[last.kind] ?? "changed"),
    taskKey: last.taskKey,
    taskTitle: last.taskTitle,
    to: moved && last.value && last.value !== "empty" ? last.value : null,
  };
}

const VERBS: Record<string, string> = { comment: "commented on", created: "created" };

/** How long a sprint has: it counts days where a release names its day. */
export function daysSaid(left: number): string {
  if (left > 1) return `${left} days left`;
  if (left === 1) return "1 day left";
  if (left === 0) return "last day";
  return left === -1 ? "1 day over" : `${-left} days over`;
}
