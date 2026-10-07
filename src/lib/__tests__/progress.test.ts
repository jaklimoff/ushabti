import { describe, expect, it } from "vitest";
import { progressOf, readProgressBy } from "../progress";
import type { PropertyDTO } from "../types";

const done = { propertyId: "p-status", optionIds: ["o-done"] };

function task(status: string | null, points?: unknown) {
  return {
    archivedAt: null,
    values: { "p-status": status, ...(points === undefined ? {} : { "p-points": points }) },
  } as Parameters<typeof progressOf>[0][number];
}

function property(id: string, type: PropertyDTO["type"]): PropertyDTO {
  return { id, name: id, type, position: "V", config: {}, options: [] };
}

describe("progressOf", () => {
  it("counts the tasks that are over by the done rule against all", () => {
    const tasks = [task("o-done"), task("o-todo"), task(null), task("o-done")];
    expect(progressOf(tasks, done, null)).toEqual({ done: 2, total: 4 });
  });

  it("counts an archived task as over, as a blocker does", () => {
    expect(progressOf([{ archivedAt: "2026-01-01", values: {} }], done, null)).toEqual({
      done: 1,
      total: 1,
    });
  });

  it("counts nothing over when the project has no done rule", () => {
    expect(progressOf([task("o-done"), task("o-todo")], null, null)).toEqual({
      done: 0,
      total: 2,
    });
  });

  it("sums the named number property, and a task with no value counts zero", () => {
    const tasks = [task("o-done", 13), task("o-done", 8), task("o-todo", 13), task("o-done")];
    expect(progressOf(tasks, done, "p-points")).toEqual({ done: 21, total: 34 });
  });

  it("sums decimals without float noise", () => {
    const tasks = [task("o-done", 0.1), task("o-done", 0.2)];
    expect(progressOf(tasks, done, "p-points")).toEqual({ done: 0.3, total: 0.3 });
  });

  it("answers zero of zero for no tasks", () => {
    expect(progressOf([], done, "p-points")).toEqual({ done: 0, total: 0 });
  });
});

describe("readProgressBy", () => {
  const properties = [property("p-points", "number"), property("p-status", "select")];

  it("keeps a number property that exists", () => {
    expect(readProgressBy("p-points", properties)).toBe("p-points");
  });

  it("drops a property that is gone, or that is not a number", () => {
    expect(readProgressBy("p-gone", properties)).toBeNull();
    expect(readProgressBy("p-status", properties)).toBeNull();
    expect(readProgressBy(null, properties)).toBeNull();
    expect(readProgressBy(7, properties)).toBeNull();
  });
});
