import { describe, expect, it } from "vitest";
import {
  buildColumns,
  columnIdForTask,
  cursorTarget,
  clampPanelWidth,
  firstTask,
  isReachable,
  longAgo,
  NO_VALUE,
  PANEL_MIN_WIDTH,
  shownColumn,
  taskByAddress,
  type BoardColumn,
} from "../board";
import { allowedColumns } from "../filters";
import type { MemberDTO, PropertyDTO, TaskDTO } from "../types";

function property(over: Partial<PropertyDTO> = {}): PropertyDTO {
  return {
    id: "p-status",
    name: "Status",
    type: "select",
    position: "V",
    config: { showOnCard: true },
    options: [
      { id: "o-todo", name: "Todo", color: "#9aa0aa", position: "V" },
      { id: "o-done", name: "Done", color: "#4f8a5b", position: "k" },
    ],
    ...over,
  };
}

function task(id: string, values: TaskDTO["values"] = {}, position = "V"): TaskDTO {
  return {
    id,
    number: 1,
    key: `USH-${id}`,
    title: id,
    description: "",
    position,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    values,
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
  };
}

const members: MemberDTO[] = [
  {
    id: "u1",
    name: "Ada",
    email: "a@x.io",
    color: "#6d5bd0",
    role: "owner",
    kind: "human",
    listeningAt: null,
  },
];

describe("board grouping", () => {
  it("puts a task in the column of its option", () => {
    const status = property();
    const columns = buildColumns(status, [task("a", { "p-status": "o-done" })], members);
    expect(columns.find((c) => c.id === "o-done")!.tasks).toHaveLength(1);
    expect(columns.find((c) => c.id === "o-todo")!.tasks).toHaveLength(0);
  });

  it("collects tasks without a value in their own column", () => {
    const status = property();
    const columns = buildColumns(status, [task("a"), task("b", { "p-status": "o-todo" })], members);
    const none = columns.find((c) => c.id === NO_VALUE);
    expect(none?.tasks.map((t) => t.id)).toEqual(["a"]);
    expect(none?.name).toBe("No status");
  });

  it("hides the empty column when every task has a value", () => {
    const status = property();
    const columns = buildColumns(status, [task("a", { "p-status": "o-todo" })], members);
    expect(columns.some((c) => c.id === NO_VALUE)).toBe(false);
  });

  it("groups by a person property", () => {
    const assignee = property({ id: "p-who", name: "Assignee", type: "person", options: [] });
    const columns = buildColumns(assignee, [task("a", { "p-who": "u1" }), task("b")], members);
    expect(columns.find((c) => c.id === "u1")!.tasks.map((t) => t.id)).toEqual(["a"]);
    expect(columns.find((c) => c.id === NO_VALUE)!.name).toBe("Unassigned");
  });

  it("groups by a checkbox property with no empty column", () => {
    const flag = property({ id: "p-flag", name: "Blocked", type: "checkbox", options: [] });
    const columns = buildColumns(flag, [task("a", { "p-flag": true }), task("b")], members);
    expect(columns.map((c) => c.id)).toEqual(["true", "false"]);
    expect(columns[0].tasks.map((t) => t.id)).toEqual(["a"]);
    expect(columns[1].tasks.map((t) => t.id)).toEqual(["b"]);
  });

  it("reads the column of a task", () => {
    const status = property();
    expect(columnIdForTask(task("a", { "p-status": "o-done" }), status)).toBe("o-done");
    expect(columnIdForTask(task("a"), status)).toBe(NO_VALUE);
    expect(columnIdForTask(task("a"), null)).toBe(NO_VALUE);
  });
});

/** A board of columns holding the task ids given, in order. */
function board(...columns: string[][]): BoardColumn[] {
  return columns.map((ids, i) => ({
    id: `c${i}`,
    name: `c${i}`,
    color: "#000000",
    value: null,
    isNone: false,
    tasks: ids.map((id) => task(id)),
  }));
}

describe("board cursor", () => {
  it("walks down and up one column", () => {
    const columns = board(["a", "b", "c"]);
    expect(cursorTarget(columns, "a", "down")).toBe("b");
    expect(cursorTarget(columns, "b", "up")).toBe("a");
  });

  it("stops at the ends instead of wrapping", () => {
    const columns = board(["a", "b"]);
    expect(cursorTarget(columns, "a", "up")).toBeNull();
    expect(cursorTarget(columns, "b", "down")).toBeNull();
  });

  /*
   * A list is one column of rows, and it walks the same function rather than
   * owning a second one. These pin that: up and down are the only steps that
   * mean anything, and the sideways loop finds no second column to go to.
   */
  it("walks a list, which is one column of rows", () => {
    const list = board(["a", "b", "c"]);
    expect(cursorTarget(list, "a", "down")).toBe("b");
    expect(cursorTarget(list, "c", "up")).toBe("b");
    expect(cursorTarget(list, "b", "first")).toBe("a");
    expect(cursorTarget(list, "b", "last")).toBe("c");
    /* Nothing wraps: a list has a top and a bottom, and both are felt. */
    expect(cursorTarget(list, "a", "up")).toBeNull();
    expect(cursorTarget(list, "c", "down")).toBeNull();
    /* A list has no sideways. */
    expect(cursorTarget(list, "b", "left")).toBeNull();
    expect(cursorTarget(list, "b", "right")).toBeNull();
  });

  it("steps over a column with no cards", () => {
    const columns = board(["a"], [], ["b"]);
    expect(cursorTarget(columns, "a", "right")).toBe("b");
    expect(cursorTarget(columns, "b", "left")).toBe("a");
  });

  /*
   * A folded column draws no cards, so the cursor has nothing to land on there
   * and steps over it exactly as it steps over an empty one. One walker, one
   * answer: a second rule for folding would be a second way to be wrong.
   */
  it("steps over a folded column", () => {
    const columns = board(["a"], ["x", "y"], ["b"]);
    columns[1].folded = true;
    expect(cursorTarget(columns, "a", "right")).toBe("b");
    expect(cursorTarget(columns, "b", "left")).toBe("a");
  });

  it("puts the cursor back on the board when its card is folded away", () => {
    const columns = board(["a", "b"], ["x"]);
    columns[0].folded = true;
    expect(isReachable(columns, "a")).toBe(false);
    expect(isReachable(columns, "x")).toBe(true);
    /* The card is still in that column, but no key can reach it any more. */
    expect(cursorTarget(columns, "a", "down")).toBe("x");
    expect(firstTask(columns)).toBe("x");
  });

  it("has nowhere to go when every column is folded", () => {
    const columns = board(["a"], ["b"]);
    for (const column of columns) column.folded = true;
    expect(firstTask(columns)).toBeNull();
    expect(cursorTarget(columns, "a", "right")).toBeNull();
  });

  it("stops at the side of the board", () => {
    const columns = board(["a"], []);
    expect(cursorTarget(columns, "a", "left")).toBeNull();
    expect(cursorTarget(columns, "a", "right")).toBeNull();
  });

  it("holds the row sideways and clamps it to a shorter column", () => {
    const columns = board(["a", "b", "c"], ["x", "y"]);
    expect(cursorTarget(columns, "b", "right")).toBe("y");
    expect(cursorTarget(columns, "c", "right")).toBe("y");
    expect(cursorTarget(columns, "y", "left")).toBe("b");
  });

  it("reaches the ends of the column with Home and End", () => {
    const columns = board(["a", "b", "c"]);
    expect(cursorTarget(columns, "b", "first")).toBe("a");
    expect(cursorTarget(columns, "b", "last")).toBe("c");
  });

  it("falls back to the first card when the cursor is nowhere", () => {
    const columns = board([], ["a", "b"]);
    expect(cursorTarget(columns, null, "down")).toBe("a");
    expect(cursorTarget(columns, "gone", "left")).toBe("a");
    expect(firstTask(columns)).toBe("a");
    expect(firstTask(board([], []))).toBeNull();
  });
});

/*
 * A phone draws one column, so one word says which. The board it is asked
 * about is the board after the filter, because a rule that names the grouping
 * property takes its columns with it — and the column a phone is on can be one
 * of them.
 */
describe("the column a phone shows", () => {
  it("opens on the first column when nothing has been picked", () => {
    expect(shownColumn(board(["a"], ["b"]), null)).toBe("c0");
    expect(shownColumn([], null)).toBeNull();
  });

  it("keeps the column that was picked", () => {
    expect(shownColumn(board(["a"], ["b"], ["c"]), "c2")).toBe("c2");
  });

  it("falls back to the first column when a filter takes that one away", () => {
    const columns = board(["a"], ["b"], ["c"]);
    columns[0].value = "o-todo";
    columns[1].value = "o-doing";
    columns[2].value = "o-done";
    const status = property({
      options: [
        { id: "o-todo", name: "Todo", color: "#9aa0aa", position: "V" },
        { id: "o-doing", name: "Doing", color: "#9aa0aa", position: "c" },
        { id: "o-done", name: "Done", color: "#4f8a5b", position: "k" },
      ],
    });
    const kept = allowedColumns(
      columns,
      { rules: [{ propertyId: "p-status", op: "is", values: ["o-todo", "o-done"] }] },
      status,
    );

    expect(kept.map((c) => c.id)).toEqual(["c0", "c2"]);
    /* Doing is gone, so the phone is on Todo rather than on nothing. */
    expect(shownColumn(kept, "c1")).toBe("c0");
    /* A column the rule kept is still the column it was on. */
    expect(shownColumn(kept, "c2")).toBe("c2");
  });
});

describe("the address of a task", () => {
  const tasks = [task("one"), task("two")];

  it("finds the task the key names, whatever the case", () => {
    expect(taskByAddress(tasks, "USH-two")?.id).toBe("two");
    expect(taskByAddress(tasks, "ush-two")?.id).toBe("two");
  });

  it("still answers a link that carries the uuid", () => {
    expect(taskByAddress(tasks, "one")?.id).toBe("one");
  });

  it("says nothing for a key no task has", () => {
    expect(taskByAddress(tasks, "USH-404")).toBeNull();
    expect(taskByAddress(tasks, null)).toBeNull();
  });
});

describe("how wide the panel may be", () => {
  it("holds the width somebody dragged", () => {
    expect(clampPanelWidth(560, 1440)).toBe(560);
  });

  it("never gives the board away", () => {
    expect(clampPanelWidth(1400, 1440)).toBe(1120);
  });

  it("keeps the panel readable, even on a window too small for both", () => {
    expect(clampPanelWidth(120, 1440)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(600, 500)).toBe(PANEL_MIN_WIDTH);
  });

  it("answers a width that is not a number at all", () => {
    expect(clampPanelWidth(Number.NaN, 1440)).toBe(PANEL_MIN_WIDTH);
  });
});

describe("how long ago, in words", () => {
  const archived = "2026-09-01T12:00:00.000Z";
  const at = (ms: number) => new Date(archived).getTime() + ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it("says just now inside the first minute", () => {
    expect(longAgo(archived, at(0))).toBe("just now");
    expect(longAgo(archived, at(59_000))).toBe("just now");
  });

  it("counts minutes, hours and days, and says one of each in the singular", () => {
    expect(longAgo(archived, at(minute))).toBe("1 minute ago");
    expect(longAgo(archived, at(5 * minute))).toBe("5 minutes ago");
    expect(longAgo(archived, at(hour))).toBe("1 hour ago");
    expect(longAgo(archived, at(3 * hour))).toBe("3 hours ago");
    expect(longAgo(archived, at(day))).toBe("1 day ago");
    expect(longAgo(archived, at(3 * day))).toBe("3 days ago");
  });

  it("goes on to months and years rather than to a calendar date", () => {
    expect(longAgo(archived, at(30 * day))).toBe("1 month ago");
    expect(longAgo(archived, at(90 * day))).toBe("3 months ago");
    expect(longAgo(archived, at(365 * day))).toBe("1 year ago");
    expect(longAgo(archived, at(800 * day))).toBe("2 years ago");
  });

  /*
   * The row is drawn on the server for a task opened by its link and again in
   * the browser. A reading that asked a calendar would answer in whatever zone
   * the reader sits in, and the two would disagree by a day.
   */
  it("reads the same in every time zone", () => {
    const old = at(400 * day);
    const zones = ["UTC", "Pacific/Kiritimati", "Pacific/Niue", "Asia/Kolkata"];
    const said = new Set<string>();
    for (const zone of zones) {
      process.env.TZ = zone;
      said.add(longAgo(archived, old));
    }
    process.env.TZ = "UTC";
    expect([...said]).toEqual(["1 year ago"]);
  });

  it("never counts backwards when two clocks disagree", () => {
    expect(longAgo(archived, at(-4000))).toBe("just now");
  });
});
