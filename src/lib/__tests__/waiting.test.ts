import { describe, expect, it } from "vitest";
import { AGENT_WAITING_KEY, applyFilters, waitingTasks } from "../filters";
import type { AgentRunDTO, FilterRule, RunStatus, TaskDTO } from "../types";
import { titleWithCount, waitingCount, waitingRows } from "../waiting";

function task(over: Partial<TaskDTO> & { number: number }): TaskDTO {
  return {
    id: `t-${over.number}`,
    key: `DP-${over.number}`,
    title: `Task ${over.number}`,
    description: "",
    position: String(over.number).padStart(3, "0"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    values: {},
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    blockedBy: [],
    parts: null,
    ...over,
  };
}

function run(taskId: string, status: RunStatus, updatedAt: string, step = ""): AgentRunDTO {
  return {
    id: `r-${taskId}`,
    taskId,
    status,
    goal: "The goal",
    step,
    control: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    beatAt: updatedAt,
    reportDueAt: null,
    endedAt: null,
    agent: { id: "a", name: "Builder", color: "#123456", emoji: null },
    stepsTotal: 0,
    stepsDone: 0,
    lastLog: null,
  };
}

describe("waitingRows", () => {
  const tasks = [1, 2, 3, 4].map((number) => task({ number }));
  const runs = [
    run("t-1", "waiting", "2026-01-02T12:00:00.000Z", "Which queue?\nMore words"),
    run("t-2", "waiting", "2026-01-02T09:00:00.000Z"),
    run("t-3", "handed_over", "2026-01-02T08:00:00.000Z", "review"),
    run("t-4", "running", "2026-01-02T07:00:00.000Z"),
  ];

  it("counts every task whose open run waits, whatever the view draws", () => {
    /* A view that draws nothing — a filter, a lens, a folded column or a list
       — hides no question. The rows never ask the view which tasks to count. */
    const none = waitingRows(tasks, runs, new Set());
    const all = waitingRows(tasks, runs, new Set(tasks.map((t) => t.id)));
    expect(none.map((r) => r.task.key)).toEqual(["DP-2", "DP-1"]);
    expect(all.map((r) => r.task.key)).toEqual(["DP-2", "DP-1"]);
  });

  it("counts exactly what the Agent waiting filter finds", () => {
    const rule: FilterRule = { propertyId: AGENT_WAITING_KEY, op: "is", values: ["true"] };
    const filtered = applyFilters(
      tasks,
      { rules: [rule] },
      [],
      "2026-01-02",
      null,
      waitingTasks(runs),
      "UTC",
    );
    const rows = waitingRows(tasks, runs, new Set());
    expect(new Set(rows.map((r) => r.task.id))).toEqual(new Set(filtered.map((t) => t.id)));
  });

  it("leaves out an archived task", () => {
    const archived = { ...tasks[0], archivedAt: "2026-01-03T00:00:00.000Z" };
    const rows = waitingRows([archived, ...tasks.slice(1)], runs, new Set());
    expect(rows.map((r) => r.task.key)).toEqual(["DP-2"]);
    /* A run whose task is not handed in at all — archived and carried
       apart — is left out too. */
    expect(waitingRows(tasks.slice(1), runs, new Set()).map((r) => r.task.key)).toEqual(["DP-2"]);
  });

  it("puts the oldest ask first and reads the first line of the question", () => {
    const [first, second] = waitingRows(tasks, runs, new Set());
    expect(first.question).toBe("Waiting for an answer");
    expect(second.question).toBe("Which queue?");
    expect(second.run.agent.name).toBe("Builder");
  });

  it("says not in this view, by the search rule, for a row the view does not draw", () => {
    const rows = waitingRows(tasks, runs, new Set(["t-1"]));
    expect(rows.find((r) => r.task.id === "t-1")?.note).toBeNull();
    expect(rows.find((r) => r.task.id === "t-2")?.note).toBe("not in this view");
  });
});

describe("waitingCount", () => {
  it("is the number of rows the top bar lists", () => {
    const tasks = [1, 2, 3].map((number) => task({ number }));
    const archived = { ...tasks[1], archivedAt: "2026-01-03T00:00:00.000Z" };
    const runs = [
      run("t-1", "waiting", "2026-01-02T12:00:00.000Z"),
      run("t-2", "waiting", "2026-01-02T09:00:00.000Z"),
      run("t-3", "handed_over", "2026-01-02T08:00:00.000Z"),
    ];
    expect(waitingCount(tasks, runs)).toBe(2);
    expect(waitingCount([tasks[0], archived, tasks[2]], runs)).toBe(1);
    expect(waitingCount(tasks, [])).toBe(0);
  });
});

describe("titleWithCount", () => {
  it("puts the count in front while there is one, and takes it off at zero", () => {
    expect(titleWithCount("Ushabti", 3)).toBe("(3) Ushabti");
    expect(titleWithCount("(3) Ushabti", 1)).toBe("(1) Ushabti");
    expect(titleWithCount("(1) Ushabti", 0)).toBe("Ushabti");
    expect(titleWithCount("Ushabti", 0)).toBe("Ushabti");
  });
});
