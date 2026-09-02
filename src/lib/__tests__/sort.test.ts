import { describe, expect, it } from "vitest";
import { cardItems, readCardView } from "../card-view";
import { canSort, nextSort, readSort, sortTasks } from "../sort";
import type { MemberDTO, PropertyDTO, TaskDTO } from "../types";

const PRIORITY: PropertyDTO = {
  id: "p-prio",
  name: "Priority",
  type: "select",
  position: "V",
  config: {},
  options: [
    { id: "o-urgent", name: "Urgent", color: "#e0574d", position: "V" },
    { id: "o-high", name: "High", color: "#d1913a", position: "k" },
    { id: "o-low", name: "Low", color: "#8b8f98", position: "s" },
  ],
};

const LABELS: PropertyDTO = {
  id: "p-labels",
  name: "Labels",
  type: "multi_select",
  position: "k",
  config: {},
  options: [
    { id: "o-bug", name: "bug", color: "#e0574d", position: "V" },
    { id: "o-docs", name: "docs", color: "#7a8a2f", position: "k" },
  ],
};

const ASSIGNEE: PropertyDTO = {
  id: "p-who",
  name: "Assignee",
  type: "person",
  position: "s",
  config: {},
  options: [],
};

const POINTS: PropertyDTO = {
  id: "p-points",
  name: "Points",
  type: "number",
  position: "u",
  config: {},
  options: [],
};

const DUE: PropertyDTO = {
  id: "p-due",
  name: "Due",
  type: "date",
  position: "w",
  config: {},
  options: [],
};

const PROPERTIES = [PRIORITY, LABELS, ASSIGNEE, POINTS, DUE];

const MEMBERS: MemberDTO[] = [
  { id: "u-ada", name: "Ada", email: "a@x.io", color: "#6d5bd0", role: "owner", kind: "human" },
  { id: "u-zoe", name: "Zoe", email: "z@x.io", color: "#2f9e7a", role: "member", kind: "human" },
];

/** Every property on the card, so every one of them is a column of the list. */
const SAVED = {
  order: ["_key", "_title", ...PROPERTIES.map((p) => p.id), "_checklist", "_comments"],
  rows: Object.fromEntries(PROPERTIES.map((p) => [p.id, { place: "footerL", mode: "text" }])),
};

const ITEMS = cardItems(readCardView(SAVED, PROPERTIES, null), PROPERTIES);

function task(id: string, values: TaskDTO["values"] = {}, over: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id,
    number: Number(id.replace(/\D/g, "")) || 1,
    key: `USH-${id}`,
    title: id,
    description: "",
    position: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    values,
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    ...over,
  };
}

function order(tasks: TaskDTO[], columnId: string, direction: "asc" | "desc"): string[] {
  return sortTasks(tasks, { columnId, direction }, ITEMS, MEMBERS).map((t) => t.id);
}

describe("what a sort does to a list", () => {
  it("orders a select by its own option order, not by its words", () => {
    /* Options are ordered by hand and that order is the meaning: Urgent above
       Low, not alphabetically between High and Medium. */
    const tasks = [
      task("a", { "p-prio": "o-low" }),
      task("b", { "p-prio": "o-urgent" }),
      task("c", { "p-prio": "o-high" }),
    ];
    expect(order(tasks, "p-prio", "asc")).toEqual(["b", "c", "a"]);
    expect(order(tasks, "p-prio", "desc")).toEqual(["a", "c", "b"]);
  });

  it("orders a multi-select by its highest option", () => {
    /* The values arrive in whatever order somebody clicked them, so the first
       one would be no answer at all. */
    const tasks = [
      task("a", { "p-labels": ["o-docs"] }),
      task("b", { "p-labels": ["o-docs", "o-bug"] }),
    ];
    expect(order(tasks, "p-labels", "asc")).toEqual(["b", "a"]);
  });

  it("orders people by name and numbers by size", () => {
    const people = [task("a", { "p-who": "u-zoe" }), task("b", { "p-who": "u-ada" })];
    expect(order(people, "p-who", "asc")).toEqual(["b", "a"]);

    /* Words would put 10 before 9. A number is a number. */
    const numbers = [task("a", { "p-points": 9 }), task("b", { "p-points": 10 })];
    expect(order(numbers, "p-points", "asc")).toEqual(["a", "b"]);
  });

  it("orders dates by the day they name", () => {
    const tasks = [task("a", { "p-due": "2026-09-02" }), task("b", { "p-due": "2026-08-30" })];
    expect(order(tasks, "p-due", "asc")).toEqual(["b", "a"]);
  });

  it("keeps a task that holds nothing at the end, whichever way it runs", () => {
    /* Turning the order around asks a question about the tasks that have an
       answer. "Nothing yet" is not a small value, and a screen that opened on
       a page of blanks would be answering a question nobody asked. */
    const tasks = [
      task("a", {}),
      task("b", { "p-prio": "o-low" }),
      task("c", { "p-prio": "o-urgent" }),
    ];
    expect(order(tasks, "p-prio", "asc")).toEqual(["c", "b", "a"]);
    expect(order(tasks, "p-prio", "desc")).toEqual(["b", "c", "a"]);
  });

  it("falls back to the rank every view shares when two compare the same", () => {
    /* So a sorted list never shuffles under a person, and still agrees with
       the board underneath it. */
    const tasks = [
      task("c", { "p-prio": "o-high" }),
      task("a", { "p-prio": "o-high" }),
      task("b", { "p-prio": "o-high" }),
    ];
    expect(order(tasks, "p-prio", "asc")).toEqual(["a", "b", "c"]);
    expect(order(tasks, "p-prio", "desc")).toEqual(["a", "b", "c"]);
  });

  it("writes nothing, so the tasks it was given are untouched", () => {
    const tasks = [task("b", { "p-prio": "o-low" }), task("a", { "p-prio": "o-urgent" })];
    const before = tasks.map((t) => t.id);
    sortTasks(tasks, { columnId: "p-prio", direction: "asc" }, ITEMS, MEMBERS);
    expect(tasks.map((t) => t.id)).toEqual(before);
  });

  it("leaves the list alone when there is no sort, or none it can read", () => {
    const tasks = [task("b"), task("a")];
    expect(sortTasks(tasks, null, ITEMS, MEMBERS).map((t) => t.id)).toEqual(["b", "a"]);
    expect(order(tasks, "p-gone", "asc")).toEqual(["b", "a"]);
  });

  it("orders the parts a task has of its own", () => {
    const tasks = [
      task("b", {}, { title: "Beta", commentCount: 1, checklistTotal: 4, checklistDone: 1 }),
      task("a", {}, { title: "Alpha", commentCount: 9, checklistTotal: 4, checklistDone: 3 }),
    ];
    expect(order(tasks, "_title", "asc")).toEqual(["a", "b"]);
    expect(order(tasks, "_comments", "asc")).toEqual(["b", "a"]);
    /* How far along, not how many: three of four is further than one of four. */
    expect(order(tasks, "_checklist", "asc")).toEqual(["b", "a"]);
  });
});

describe("one press on a heading", () => {
  it("goes down, then up, then back to the order the board keeps", () => {
    /* The third press matters most: the shared rank is the only order a drag
       can write, so somebody who sorts has to be able to get back to it. */
    const first = nextSort(null, "p-prio");
    expect(first).toEqual({ columnId: "p-prio", direction: "asc" });
    const second = nextSort(first, "p-prio");
    expect(second).toEqual({ columnId: "p-prio", direction: "desc" });
    expect(nextSort(second, "p-prio")).toBeNull();
  });

  it("starts again on another column", () => {
    const current = { columnId: "p-prio", direction: "desc" as const };
    expect(nextSort(current, "p-due")).toEqual({ columnId: "p-due", direction: "asc" });
  });
});

describe("reading a saved sort", () => {
  it("keeps one that names a column that is still there", () => {
    expect(readSort({ columnId: "p-prio", direction: "desc" }, PROPERTIES)).toEqual({
      columnId: "p-prio",
      direction: "desc",
    });
    expect(readSort({ columnId: "_key", direction: "asc" }, PROPERTIES)).toEqual({
      columnId: "_key",
      direction: "asc",
    });
  });

  it("throws away one that names nothing, exactly as a filter is read", () => {
    /* Nothing rewrites a view when the property its sort names is deleted, so
       an order nobody can see must never keep deciding what a list looks like. */
    expect(readSort({ columnId: "p-gone", direction: "asc" }, PROPERTIES)).toBeNull();
    expect(readSort({ columnId: "p-prio", direction: "sideways" }, PROPERTIES)).toBeNull();
    expect(readSort({ columnId: "_desc", direction: "asc" }, PROPERTIES)).toBeNull();
    expect(readSort(null, PROPERTIES)).toBeNull();
    expect(readSort("desc", PROPERTIES)).toBeNull();
  });
});

describe("which headings can be pressed", () => {
  it("is every column a list draws", () => {
    expect(ITEMS.filter((i) => i.place !== "off").every(canSort)).toBe(true);
  });
});
