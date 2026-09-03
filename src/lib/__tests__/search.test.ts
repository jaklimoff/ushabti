import { describe, expect, it } from "vitest";
import { searchTasks } from "../search";
import type { TaskDTO } from "../types";

function task(over: Partial<TaskDTO> & { number: number }): TaskDTO {
  return {
    id: `t-${over.number}`,
    key: `DP-${over.number}`,
    title: "",
    description: "",
    position: String(over.number).padStart(3, "0"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    values: {},
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    ...over,
  };
}

const TASKS: TaskDTO[] = [
  task({ number: 1, title: "Log in with a passkey" }),
  task({ number: 4, title: "Rate limit the sign-in route" }),
  task({
    number: 14,
    title: "Write the login guide",
    description: "Screenshots of the log in box.",
  }),
  task({ number: 40, title: "Ship the release image" }),
];

function keys(query: string, tasks = TASKS): string[] {
  return searchTasks(tasks, query).map((hit) => hit.task.key);
}

describe("searchTasks", () => {
  it("finds nothing until there is something to find", () => {
    expect(searchTasks(TASKS, "")).toEqual([]);
    expect(searchTasks(TASKS, "   ")).toEqual([]);
  });

  it("answers a key, whatever case it is typed in", () => {
    expect(keys("dp-4")[0]).toBe("DP-4");
    expect(keys("DP-4")[0]).toBe("DP-4");
  });

  it("puts the task a bare number names above the keys that merely start that way", () => {
    // "4" is in DP-4, DP-14 and DP-40. Only one of them is task 4.
    expect(keys("4")).toEqual(["DP-4", "DP-14", "DP-40"]);
  });

  it("puts an exact key above the longer keys it is the start of", () => {
    expect(keys("dp-1")).toEqual(["DP-1", "DP-14"]);
  });

  it("finds words in the title, and prefers a title that starts with them", () => {
    expect(keys("log")).toEqual(["DP-1", "DP-14"]);
  });

  it("finds words in the description and says which line they were on", () => {
    const [hit] = searchTasks(TASKS, "screenshots");
    expect(hit.task.key).toBe("DP-14");
    expect(hit.snippet).toBe("Screenshots of the log in box.");
  });

  it("carries no line when the title already says why", () => {
    expect(searchTasks(TASKS, "guide")[0].snippet).toBeNull();
  });

  it("narrows on every word, wherever each one sits", () => {
    expect(keys("login guide")).toEqual(["DP-14"]);
    // One word in the title, the other in the description.
    expect(keys("guide screenshots")).toEqual(["DP-14"]);
    expect(keys("login image")).toEqual([]);
  });

  it("keeps the order every view shares when two hits are equally good", () => {
    const same = [
      task({ number: 9, title: "Same words here", position: "s" }),
      task({ number: 8, title: "Same words here", position: "V" }),
    ];
    expect(keys("same words", same)).toEqual(["DP-8", "DP-9"]);
  });

  it("draws no more than it was asked for", () => {
    expect(searchTasks(TASKS, "dp", 2)).toHaveLength(2);
  });
});
