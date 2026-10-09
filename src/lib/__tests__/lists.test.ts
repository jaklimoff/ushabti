import { describe, expect, it } from "vitest";
import { ME_KEY } from "../filters";
import {
  EVERY_TASK,
  listGroups,
  rulesSaid,
  sourceRules,
  summaryOf,
  type SourceBoard,
} from "../lists";
import type {
  AgentRunDTO,
  BoardData,
  PropertyDTO,
  PropertyOptionDTO,
  RunStatus,
  TaskDTO,
} from "../types";

/*
 * How a list reads its sources: the board's own rules against the board's
 * own live tasks, one project at a time.
 */

function option(id: string, name: string, color: string, position: string): PropertyOptionDTO {
  return { id, name, color, position, startAt: null, targetAt: null, shippedAt: null, note: null };
}

function statusOf(project: string): PropertyDTO {
  return {
    id: `${project}-status`,
    name: "Status",
    type: "select",
    position: "a",
    config: {},
    options: [
      option(`${project}-todo`, "Todo", "#111111", "a"),
      option(`${project}-done`, "Done", "#222222", "b"),
    ],
  };
}

function ownerOf(project: string): PropertyDTO {
  return {
    id: `${project}-owner`,
    name: "Owner",
    type: "person",
    position: "b",
    config: {},
    options: [],
  };
}

function task(project: string, number: number, values: TaskDTO["values"]): TaskDTO {
  return {
    id: `${project}-t${number}`,
    number,
    key: `${project.toUpperCase()}-${number}`,
    title: `Task ${number}`,
    description: "",
    position: String(number).padStart(3, "0"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    values,
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    blockedBy: [],
    parts: null,
  };
}

function run(taskId: string, status: RunStatus): AgentRunDTO {
  return {
    taskId,
    status,
    agent: { id: "a-1", name: "Builder", color: "#999999", emoji: null },
  } as AgentRunDTO;
}

function board(project: string, tasks: TaskDTO[], runs: AgentRunDTO[] = []): SourceBoard {
  return {
    project: {
      id: project,
      key: project.toUpperCase(),
      name: `Project ${project}`,
      timeZone: "UTC",
    } as BoardData["project"],
    today: "2026-10-09",
    members: [
      {
        id: "u-me",
        name: "Me",
        email: "me@example.com",
        color: "#aaaaaa",
        emoji: null,
        role: "owner",
        kind: "human",
        listeningAt: null,
      },
    ],
    former: [],
    properties: [statusOf(project), ownerOf(project)],
    tasks,
    runs,
  };
}

const todo = (project: string) => ({
  propertyId: `${project}-status`,
  op: "is" as const,
  values: [`${project}-todo`],
});
const mine = (project: string) => ({
  propertyId: `${project}-owner`,
  op: "is" as const,
  values: [ME_KEY],
});

const one = board("a", [
  task("a", 1, { "a-status": "a-todo", "a-owner": "u-me" }),
  task("a", 2, { "a-status": "a-todo" }),
  task("a", 3, { "a-status": "a-done", "a-owner": "u-me" }),
]);
const two = board(
  "b",
  [
    task("b", 1, { "b-status": "b-todo", "b-owner": "u-me" }),
    task("b", 2, { "b-status": "b-done" }),
    { ...task("b", 3, { "b-status": "b-todo", "b-owner": "u-me" }), archivedAt: "2026-02-01" },
  ],
  [run("b-t1", "waiting")],
);

const keys = (groups: ReturnType<typeof listGroups>) =>
  groups.flatMap((g) => g.rows.map((r) => r.key));

describe("listGroups", () => {
  it("keeps the tasks that pass every rule of a source, with Me read as the viewer", () => {
    const groups = listGroups(
      [{ id: "s1", projectId: "a", filters: { rules: [todo("a"), mine("a")] } }],
      [one],
      "u-me",
    );
    expect(keys(groups)).toEqual(["A-1"]);
    expect(groups[0].rules).toEqual(["Status is Todo · Owner is Me"]);
    expect(groups[0].rows[0].chip).toEqual({ text: "Todo", color: "#111111" });
  });

  it("joins the sources of one project: a task passes any one of them, once", () => {
    const groups = listGroups(
      [
        { id: "s1", projectId: "a", filters: { rules: [todo("a")] } },
        { id: "s2", projectId: "a", filters: { rules: [mine("a")] } },
      ],
      [one],
      "u-me",
    );
    expect(keys(groups)).toEqual(["A-1", "A-2", "A-3"]);
    expect(groups[0].count).toBe(3);
  });

  it("groups by project in the order of the boards, and leaves archived tasks out", () => {
    const groups = listGroups(
      [
        { id: "s2", projectId: "b", filters: { rules: [todo("b")] } },
        { id: "s1", projectId: "a", filters: { rules: [] } },
      ],
      [one, two],
      "u-me",
    );
    expect(groups.map((g) => g.key)).toEqual(["A", "B"]);
    expect(keys(groups)).toEqual(["A-1", "A-2", "A-3", "B-1"]);
    expect(groups[0].rules).toEqual([EVERY_TASK]);
    expect(groups[0].rows[0].chip).toBeNull();
  });

  it("says nothing waits for the person on a hand-over, and names no agent at work", () => {
    const handed = board("b", two.tasks, [run("b-t1", "handed_over")]);
    const [group] = listGroups(
      [{ id: "s", projectId: "b", filters: { rules: [] } }],
      [handed],
      "u-me",
    );
    expect(group.rows[0]).toMatchObject({ key: "B-1", waiting: false, agent: null });
  });

  it("says a run waits, and names the agent at work", () => {
    const working = board("b", two.tasks, [run("b-t1", "running"), run("b-t2", "waiting")]);
    const [group] = listGroups(
      [{ id: "s", projectId: "b", filters: { rules: [] } }],
      [working],
      "u-me",
    );
    expect(group.rows.map((r) => [r.key, r.waiting, r.agent])).toEqual([
      ["B-1", false, "Builder"],
      ["B-2", true, null],
    ]);
  });

  it("brings nothing from a project with no board: the person left it", () => {
    const groups = listGroups(
      [
        { id: "s1", projectId: "a", filters: { rules: [] } },
        { id: "s2", projectId: "gone", filters: { rules: [] } },
      ],
      [one],
      "u-me",
    );
    expect(groups.map((g) => g.projectId)).toEqual(["a"]);
  });

  it("drops a rule about a deleted property or option, and still lists the source", () => {
    const raw = {
      rules: [
        { propertyId: "deleted-property", op: "is", values: ["x"] },
        { propertyId: "a-status", op: "is", values: ["deleted-option"] },
      ],
    };
    expect(sourceRules(raw, one)).toEqual({ rules: [] });
    const groups = listGroups([{ id: "s", projectId: "a", filters: raw }], [one], "u-me");
    expect(keys(groups)).toEqual(["A-1", "A-2", "A-3"]);
    expect(groups[0].rules).toEqual([EVERY_TASK]);
  });
});

describe("rulesSaid and summaryOf", () => {
  it("says the rules as the chips do", () => {
    expect(rulesSaid({ rules: [todo("a")] }, one)).toBe("Status is Todo");
    expect(rulesSaid({ rules: [] }, one)).toBe(EVERY_TASK);
  });

  it("counts the whole list and each project", () => {
    const groups = listGroups(
      [
        { id: "s1", projectId: "a", filters: { rules: [todo("a")] } },
        { id: "s2", projectId: "b", filters: { rules: [] } },
      ],
      [one, two],
      "u-me",
    );
    expect(summaryOf({ id: "l", name: "Next" }, groups)).toEqual({
      id: "l",
      name: "Next",
      count: 4,
      projects: [
        { key: "A", count: 2, rules: ["Status is Todo"] },
        { key: "B", count: 2, rules: [EVERY_TASK] },
      ],
    });
  });
});
