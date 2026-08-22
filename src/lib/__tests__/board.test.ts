import { describe, expect, it } from "vitest";
import { buildColumns, columnIdForTask, leadProperty, NO_VALUE } from "../board";
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
    values,
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
  };
}

const members: MemberDTO[] = [
  { id: "u1", name: "Ada", email: "a@x.io", color: "#6d5bd0", role: "owner" },
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

  it("picks the first visible select that is not the column property", () => {
    const status = property();
    const priority = property({ id: "p-prio", name: "Priority", position: "k" });
    const phase = property({ id: "p-phase", name: "Phase", position: "s" });
    expect(leadProperty([status, priority, phase], "p-status")?.id).toBe("p-prio");
    expect(leadProperty([status, priority, phase], "p-prio")?.id).toBe("p-status");

    const hidden = property({
      id: "p-prio",
      name: "Priority",
      position: "k",
      config: { showOnCard: false },
    });
    expect(leadProperty([status, hidden, phase], "p-status")?.id).toBe("p-phase");
  });
});
