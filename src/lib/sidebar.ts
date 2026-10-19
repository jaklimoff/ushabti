import type { ProjectNow } from "./queries";
import { elapsed } from "./run-state";

/**
 * The sidebar's fold, the one browser preference the server reads. It moves
 * the whole page, so a fold read after the first paint would make the board
 * jump sideways on every load.
 */
export const FOLD_COOKIE = "ushabti-sidebar";

/** A year: the fold belongs to the device, not to a visit. */
const FOLD_MAX_AGE = 60 * 60 * 24 * 365;

/** Folded unless this device said open. */
export function readFolded(value: string | undefined): boolean {
  return value !== "open";
}

export function foldCookie(folded: boolean): string {
  return `${FOLD_COOKIE}=${folded ? "folded" : "open"}; path=/; max-age=${FOLD_MAX_AGE}; samesite=lax`;
}

/** A list the sidebar names. */
export type SidebarList = { id: string; name: string };

/**
 * One project and no list has nowhere else to go, so nothing is drawn. A
 * second project or a first list brings the sidebar.
 */
export function sidebarShown(projects: readonly unknown[], lists: readonly unknown[]): boolean {
  return projects.length > 1 || lists.length > 0;
}

/** The project of an address, or null off a project page. */
export function projectOfPath(path: string | null): string | null {
  return /^\/p\/([^/?#]+)/.exec(path ?? "")?.[1] ?? null;
}

export type Line = {
  /** Waiting outranks working, and working outranks a silent agent. */
  kind: "waiting" | "working" | "silent" | "quiet";
  text: string;
};

/**
 * The line under a project's name. Something waiting for the person is what
 * they came for, so it outranks an agent at work. A silent agent reads as
 * Home reads it: named, and silent.
 */
export function lineOf(project: ProjectNow, now: number = Date.now()): Line {
  if (project.waiting > 0) return { kind: "waiting", text: `${project.waiting} waiting for you` };
  const working = project.agents
    .filter((a) => a.working)
    .sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt));
  const more = (n: number) => (n > 1 ? ` +${n - 1}` : "");
  if (working.length > 0) {
    const first = working[0];
    const on = first.taskKey ? ` on ${first.taskKey}` : "";
    return {
      kind: "working",
      text: `${first.name}${on} · ${elapsed(first.reportedAt, now)}${more(working.length)}`,
    };
  }
  const silent = project.agents.filter((a) => !a.working);
  if (silent.length > 0)
    return { kind: "silent", text: `${silent[0].name} silent${more(silent.length)}` };
  return { kind: "quiet", text: "Quiet" };
}

/** Whether a project has an agent at work, which is what the dot says. */
export function isWorking(project: ProjectNow): boolean {
  return project.agents.some((a) => a.working);
}
