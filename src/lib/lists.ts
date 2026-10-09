import {
  applyFilters,
  describeRule,
  filterProperties,
  isBuiltIn,
  isSetOp,
  keyColor,
  keyName,
  keysOf,
  readFilters,
  waitingTasks,
} from "./filters";
import { isWaiting } from "./run-state";
import type { BoardData, FilterRule, PropertyDTO, TaskDTO, ViewFilters } from "./types";

/**
 * A list: one person's tasks from several projects, picked by rules.
 *
 * Each source is one project and a set of the board's own rules. They are
 * read here through `readFilters` against that project every time, exactly
 * as a view's are, so a rule about a deleted property or option is gone and
 * the source still lists. The tasks are the board's own live ones, and they
 * pass through `applyFilters`, so a list can never count a task the board
 * would hide under the same rules. Nothing here is rewritten in SQL.
 */

/** What a list needs of one project: what the board itself reads. */
export type SourceBoard = Pick<
  BoardData,
  "project" | "today" | "members" | "former" | "properties" | "tasks" | "runs"
>;

/** A source as it is stored: the rules are raw until a board reads them. */
export type StoredSource = { id: string; projectId: string; filters: unknown };

/** A short label beside a row: the value its first rule matched. */
export type RowChip = { text: string; color: string };

export type ListRow = {
  id: string;
  key: string;
  title: string;
  projectId: string;
  /** Its open run asks a person something. */
  waiting: boolean;
  /** The agent at work on it, if a run is open and not waiting. */
  agent: string | null;
  chip: RowChip | null;
  createdAt: string;
};

export type ListGroup = {
  projectId: string;
  key: string;
  name: string;
  count: number;
  /** The rules of each source of this project, in words. */
  rules: string[];
  rows: ListRow[];
};

/** Said for a source with no rules: it brings every task of its project. */
export const EVERY_TASK = "Every task";

/** The rules of one source, read against its project as the board reads a view. */
export function sourceRules(raw: unknown, board: SourceBoard): ViewFilters {
  return readFilters(raw, board.properties);
}

/** The live tasks of the project that pass every rule of the source. */
export function sourceTasks(
  filters: ViewFilters,
  board: SourceBoard,
  viewer: string | null,
): TaskDTO[] {
  return applyFilters(
    board.tasks.filter((t) => !t.archivedAt),
    filters,
    board.properties,
    board.today,
    viewer,
    waitingTasks(board.runs),
    board.project.timeZone,
  );
}

/** The rules in words, as the chips on a board say them. */
export function rulesSaid(filters: ViewFilters, board: SourceBoard): string {
  const askable = filterProperties(board.properties);
  const words = filters.rules.flatMap((rule) => {
    const property = askable.find((p) => p.id === rule.propertyId);
    return property ? [describeRule(rule, property, board.members, board.former)] : [];
  });
  return words.length ? words.join(" · ") : EVERY_TASK;
}

const QUIET = "#6b7280";

/**
 * What the task holds for the property of a rule, as one short chip. A set
 * reads its keys as a filter chip names them, so "Unassigned" and "No
 * priority" read here as they do on the board. A word that is not a property
 * — Blocked, Agent waiting, a stamp — says the rule, since the task holds no
 * value for it.
 */
export function matchedChip(task: TaskDTO, rule: FilterRule, board: SourceBoard): RowChip | null {
  const property = filterProperties(board.properties).find((p) => p.id === rule.propertyId);
  if (!property) return null;
  if (isBuiltIn(property.id)) {
    return { text: describeRule(rule, property, board.members, board.former), color: QUIET };
  }
  const value = task.values[property.id] ?? null;
  if (isSetOp(rule.op) || keyed(property)) {
    const keys = keysOf(value, property.type);
    const text = keys.map((k) => keyName(k, property, board.members, board.former)).join(", ");
    return { text, color: keyColor(keys[0], property, board.members, board.former) };
  }
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return { text: `No ${property.name.toLowerCase()}`, color: QUIET };
  }
  if (property.type === "link") {
    return { text: describeRule(rule, property, board.members, board.former), color: QUIET };
  }
  return { text: String(value), color: QUIET };
}

function keyed(property: PropertyDTO): boolean {
  return property.options.length > 0 || property.type === "person" || property.type === "checkbox";
}

/**
 * A list's tasks, grouped by project in the order the person's projects come
 * in. A task is on the list when it passes any one of its sources; a source
 * whose project is not in `boards` — the person left it — brings nothing and
 * draws nothing. Inside a group the tasks keep the board's own order.
 */
export function listGroups(
  sources: StoredSource[],
  boards: SourceBoard[],
  viewer: string | null,
): ListGroup[] {
  const groups: ListGroup[] = [];
  for (const board of boards) {
    const mine = sources.filter((s) => s.projectId === board.project.id);
    if (mine.length === 0) continue;
    const waits = new Map<string, boolean>();
    const agents = new Map<string, string>();
    for (const run of board.runs) {
      /* A hand-over waits for the next agent, not for the person, so only a
         question earns "Waiting for you". Neither run is at work. */
      if (run.status === "waiting") waits.set(run.taskId, true);
      else if (!isWaiting(run.status)) agents.set(run.taskId, run.agent.name);
    }
    const picked = new Map<string, RowChip | null>();
    const rules: string[] = [];
    for (const source of mine) {
      const filters = sourceRules(source.filters, board);
      rules.push(rulesSaid(filters, board));
      for (const task of sourceTasks(filters, board, viewer)) {
        if (picked.has(task.id)) continue;
        const first = filters.rules[0];
        picked.set(task.id, first ? matchedChip(task, first, board) : null);
      }
    }
    const rows = board.tasks
      .filter((t) => picked.has(t.id))
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
      .map((t) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        projectId: board.project.id,
        waiting: waits.get(t.id) ?? false,
        agent: agents.get(t.id) ?? null,
        chip: picked.get(t.id) ?? null,
        createdAt: t.createdAt,
      }));
    groups.push({
      projectId: board.project.id,
      key: board.project.key,
      name: board.project.name,
      count: rows.length,
      rules,
      rows,
    });
  }
  return groups;
}

/** How many rows a list's card on Home shows before "+N more". */
export const CARD_ROWS = 5;

/**
 * A list as its card on Home reads it: the first rows in the list page's own
 * order, and the total. The rules stay on the list page.
 */
export type ListSummary = {
  id: string;
  name: string;
  count: number;
  rows: ListRow[];
};

export function summaryOf(list: { id: string; name: string }, groups: ListGroup[]): ListSummary {
  return {
    id: list.id,
    name: list.name,
    count: groups.reduce((sum, g) => sum + g.count, 0),
    rows: groups.flatMap((g) => g.rows).slice(0, CARD_ROWS),
  };
}
