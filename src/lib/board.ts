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
  /** Folded to a strip in this browser. Nobody else's board knows. */
  folded?: boolean;
  tasks: TaskDTO[];
};

/**
 * The cards the cursor can reach in a column. A folded column draws none, so
 * it holds none as far as a key is concerned — the same answer an empty column
 * already gives, which is why the walk below needs no second rule for it.
 */
function reachable(column: BoardColumn): TaskDTO[] {
  return column.folded ? [] : column.tasks;
}

/** Whether the cursor can sit on this card. */
export function isReachable(columns: BoardColumn[], taskId: string | null): boolean {
  return columns.some((c) => reachable(c).some((t) => t.id === taskId));
}

/**
 * One value of the group property, turned into a column id.
 *
 * The sweep that archives a column asks this too, on the server, so that "in
 * this column" means the same thing on both sides of the wire.
 */
export function columnIdForValue(
  value: TaskValue | undefined,
  property: { type: PropertyDTO["type"] } | null,
): string {
  if (!property) return NO_VALUE;
  if (property.type === "checkbox") return value === true ? "true" : "false";
  if (value === null || value === undefined || value === "") return NO_VALUE;
  if (Array.isArray(value)) return value.length ? String(value[0]) : NO_VALUE;
  return String(value);
}

/** The value of the group property, turned into a column id. */
export function columnIdForTask(task: TaskDTO, property: PropertyDTO | null): string {
  return columnIdForValue(property ? task.values[property.id] : null, property);
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
    const tasks = reachable(column);
    if (tasks.length) return tasks[0].id;
  }
  return null;
}

/**
 * The card the cursor lands on, or null when there is nowhere to go. Sideways
 * it holds the row and steps over a column with no cards, because an empty
 * column has nothing to put the cursor on. A folded column is stepped over for
 * the same reason: it draws no cards, so there is nothing there to reach.
 * Nothing wraps: the board is a map, and a map has edges.
 */
export function cursorTarget(
  columns: BoardColumn[],
  taskId: string | null,
  step: CursorStep,
): string | null {
  const at = columns.findIndex((c) => reachable(c).some((t) => t.id === taskId));
  if (at < 0) return firstTask(columns);

  const tasks = reachable(columns[at]);
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
        const beside = reachable(columns[i]);
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
 * How wide the task panel may be dragged. The board never disappears behind
 * it: a board you cannot see is a board you cannot drop a card on, so a strip
 * of it always stays. A narrow window beats a wide stored width, which is why
 * this is asked again on every resize and not only when the width is written.
 */
export const PANEL_MIN_WIDTH = 340;
const BOARD_MIN_WIDTH = 320;

export function clampPanelWidth(width: number, windowWidth: number): number {
  const most = Math.max(PANEL_MIN_WIDTH, Math.round(windowWidth) - BOARD_MIN_WIDTH);
  if (!Number.isFinite(width)) return PANEL_MIN_WIDTH;
  return Math.min(Math.max(Math.round(width), PANEL_MIN_WIDTH), most);
}

/**
 * The address of a task is the key a person reads on the card — DP-4 — because
 * that is the word they say out loud. A link written before that was true
 * carries the uuid, so both are answered here and neither one breaks.
 */
export function taskByAddress<T extends { id: string; key: string }>(
  tasks: T[],
  address: string | null,
): T | null {
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

/**
 * How long ago, in words rather than in the short form a feed uses. One row
 * says it, at the top of an archived task, and a row of prose says "3 days
 * ago" where a timestamp column says "3d".
 *
 * It takes the clock rather than reading it, exactly as `elapsed` does, and it
 * never reaches for a calendar. That is deliberate: this row is drawn on the
 * server for a task opened by its link and again in the browser, and a date
 * made of `getMonth()` and `getDate()` is read in whatever zone the reader is
 * in — the same trap the written-out month names below exist for. Months and
 * years are counted here in plain arithmetic, so the two renders agree
 * wherever they run.
 */
export function longAgo(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  /* The average length of a month and a year. A row that says "2 months ago"
     is not making a claim a calendar could disagree with. */
  const month = 30 * day;
  const year = 365 * day;
  if (diff < minute) return "just now";
  if (diff < hour) return plural(Math.floor(diff / minute), "minute");
  if (diff < day) return plural(Math.floor(diff / hour), "hour");
  if (diff < month) return plural(Math.floor(diff / day), "day");
  if (diff < year) return plural(Math.floor(diff / month), "month");
  return plural(Math.floor(diff / year), "year");
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"} ago`;
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
