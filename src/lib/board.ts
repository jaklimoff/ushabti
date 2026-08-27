import type { MemberDTO, PropertyDTO, TaskDTO, TaskValue } from "./types";

export const NO_VALUE = "__none__";

export type BoardColumn = {
  /** Option id, member id, "true" / "false", or NO_VALUE. */
  id: string;
  name: string;
  color: string;
  /** The value written to the group property when a card lands here. */
  value: TaskValue;
  isNone: boolean;
  tasks: TaskDTO[];
};

/** The value of the group property, turned into a column id. */
export function columnIdForTask(task: TaskDTO, property: PropertyDTO | null): string {
  if (!property) return NO_VALUE;
  const value = task.values[property.id];
  if (property.type === "checkbox") return value === true ? "true" : "false";
  if (value === null || value === undefined || value === "") return NO_VALUE;
  if (Array.isArray(value)) return value.length ? String(value[0]) : NO_VALUE;
  return String(value);
}

export function buildColumns(
  property: PropertyDTO | null,
  tasks: TaskDTO[],
  members: MemberDTO[],
): BoardColumn[] {
  const columns: BoardColumn[] = [];

  if (!property) {
    columns.push({
      id: NO_VALUE,
      name: "All tasks",
      color: "#6b7280",
      value: null,
      isNone: true,
      tasks: [],
    });
  } else if (property.type === "select") {
    for (const option of property.options) {
      columns.push({
        id: option.id,
        name: option.name,
        color: option.color,
        value: option.id,
        isNone: false,
        tasks: [],
      });
    }
    columns.push({
      id: NO_VALUE,
      name: `No ${property.name.toLowerCase()}`,
      color: "#3f4650",
      value: null,
      isNone: true,
      tasks: [],
    });
  } else if (property.type === "person") {
    for (const member of members) {
      columns.push({
        id: member.id,
        name: member.name,
        color: member.color,
        value: member.id,
        isNone: false,
        tasks: [],
      });
    }
    columns.push({
      id: NO_VALUE,
      name: "Unassigned",
      color: "#3f4650",
      value: null,
      isNone: true,
      tasks: [],
    });
  } else if (property.type === "checkbox") {
    columns.push({
      id: "true",
      name: property.name,
      color: "#4f8a5b",
      value: true,
      isNone: false,
      tasks: [],
    });
    columns.push({
      id: "false",
      name: `Not ${property.name.toLowerCase()}`,
      color: "#6b7280",
      value: false,
      isNone: false,
      tasks: [],
    });
  }

  const byId = new Map(columns.map((c) => [c.id, c]));
  const fallback = byId.get(NO_VALUE) ?? columns[columns.length - 1];

  for (const task of tasks) {
    const column = byId.get(columnIdForTask(task, property)) ?? fallback;
    column?.tasks.push(task);
  }

  // A column for "no value" only earns its place when something sits in it, or
  // when the board would otherwise have nowhere to drop a card.
  return columns.filter((c) => !c.isNone || c.tasks.length > 0 || columns.length === 1);
}

/** Where one press of an arrow, Home or End takes the board cursor. */
export type CursorStep = "up" | "down" | "left" | "right" | "first" | "last";

/** The card the cursor starts on: the top of the first column that has one. */
export function firstTask(columns: BoardColumn[]): string | null {
  for (const column of columns) {
    if (column.tasks.length) return column.tasks[0].id;
  }
  return null;
}

/**
 * The card the cursor lands on, or null when there is nowhere to go. Sideways
 * it holds the row and steps over a column with no cards, because an empty
 * column has nothing to put the cursor on. Nothing wraps: the board is a map,
 * and a map has edges.
 */
export function cursorTarget(
  columns: BoardColumn[],
  taskId: string | null,
  step: CursorStep,
): string | null {
  const at = columns.findIndex((c) => c.tasks.some((t) => t.id === taskId));
  if (at < 0) return firstTask(columns);

  const tasks = columns[at].tasks;
  const row = tasks.findIndex((t) => t.id === taskId);

  switch (step) {
    case "up":
      return tasks[row - 1]?.id ?? null;
    case "down":
      return tasks[row + 1]?.id ?? null;
    case "first":
      return tasks[0]?.id ?? null;
    case "last":
      return tasks[tasks.length - 1]?.id ?? null;
    default: {
      const way = step === "left" ? -1 : 1;
      for (let i = at + way; i >= 0 && i < columns.length; i += way) {
        const beside = columns[i].tasks;
        if (beside.length) return beside[Math.min(row, beside.length - 1)].id;
      }
      return null;
    }
  }
}

export function sortByPosition<T extends { position: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

/**
 * The address of a task is the key a person reads on the card — DP-4 — because
 * that is the word they say out loud. A link written before that was true
 * carries the uuid, so both are answered here and neither one breaks.
 */
export function taskByAddress(tasks: TaskDTO[], address: string | null): TaskDTO | null {
  if (!address) return null;
  const wanted = address.trim().toLowerCase();
  return (
    tasks.find((t) => t.key.toLowerCase() === wanted) ?? tasks.find((t) => t.id === address) ?? null
  );
}

export function optionById(property: PropertyDTO | undefined, id: unknown) {
  if (!property || typeof id !== "string") return undefined;
  return property.options.find((o) => o.id === id);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The board is drawn on the server and again in the browser, so a date must
 * read the same in both places. `toLocaleDateString` does not do that: the
 * server uses the locale of the Node process and writes "Aug 28", while a
 * browser set to en-GB writes "28 Aug". React sees the two texts disagree and
 * throws away the server tree. The month names are therefore written out here.
 */
function shortDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return shortDate(parsed);
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return shortDate(new Date(iso));
}
