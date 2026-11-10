import { describe, expect, test } from "vitest";
import { shareEqual } from "./share";

describe("shareEqual", () => {
  const before = {
    tasks: [
      { id: "a", title: "One", values: { p: "x" } },
      { id: "b", title: "Two", values: { p: ["y"] } },
    ],
    project: { key: "K" },
  };
  const copy = () => JSON.parse(JSON.stringify(before)) as typeof before;

  test("an answer that reads the same is the object it was", () => {
    expect(shareEqual(before, copy())).toBe(before);
  });

  test("a task that changed is new, and the rest keep their objects", () => {
    const fresh = copy();
    fresh.tasks[1].title = "Renamed";
    const out = shareEqual(before, fresh);
    expect(out).not.toBe(before);
    expect(out.tasks[0]).toBe(before.tasks[0]);
    expect(out.tasks[1]).toEqual(fresh.tasks[1]);
    expect(out.tasks[1].values).toBe(before.tasks[1].values);
    expect(out.project).toBe(before.project);
  });

  test("a list with ids is matched by id, so a task added on top moves nothing", () => {
    const fresh = copy();
    fresh.tasks.unshift({ id: "c", title: "New", values: { p: "z" } });
    const out = shareEqual(before, fresh);
    expect(out.tasks[1]).toBe(before.tasks[0]);
    expect(out.tasks[2]).toBe(before.tasks[1]);
  });

  test("a key taken away or added is a change", () => {
    const fresh = copy() as unknown as { tasks: { id: string; values: Record<string, unknown> }[] };
    delete fresh.tasks[0].values.p;
    expect(shareEqual(before, fresh as never).tasks[0]).not.toBe(before.tasks[0]);
    const more = copy() as unknown as { project: Record<string, unknown> };
    more.project.extra = null;
    expect(shareEqual(before, more as never).project).not.toBe(before.project);
  });
});
