import { describe, expect, it } from "vitest";
import { daysIn, roadmapAxis, roadmapRows, type RoadmapTask } from "../roadmap";
import type { PropertyDTO, PropertyOptionDTO } from "../types";

function option(id: string, dates: Partial<PropertyOptionDTO> = {}): PropertyOptionDTO {
  return {
    id,
    name: id,
    color: "#4b8fbe",
    position: id,
    startAt: null,
    targetAt: null,
    shippedAt: null,
    note: null,
    ...dates,
  };
}

function release(options: PropertyOptionDTO[]): PropertyDTO {
  return { id: "p-version", name: "Version", type: "select", position: "V", config: {}, options };
}

function task(version: string, createdAt: string, status = "o-todo"): RoadmapTask {
  return { archivedAt: null, createdAt, values: { "p-version": version, "p-status": status } };
}

const rule = { doneWhen: { propertyId: "p-status", optionId: "o-done" }, countBy: null };

describe("roadmapRows", () => {
  it("draws one row per option with a target date, in option order", () => {
    const property = release([
      option("v1", { startAt: "2026-09-01", targetAt: "2026-09-30" }),
      option("v2"),
      option("v3", { startAt: "2026-10-01", targetAt: "2026-10-31" }),
    ]);
    expect(roadmapRows(property, [], [], rule, "UTC").map((r) => r.id)).toEqual(["v1", "v3"]);
  });

  it("runs the bar from the start date to the target date", () => {
    const property = release([option("v1", { startAt: "2026-09-01", targetAt: "2026-09-30" })]);
    const [row] = roadmapRows(property, [task("v1", "2026-08-01T10:00:00Z")], [], rule, "UTC");
    expect([row.start, row.end]).toEqual(["2026-09-01", "2026-09-30"]);
  });

  it("starts at the oldest task under the option when it has no start, in the project's zone", () => {
    const property = release([option("v1", { targetAt: "2026-09-30" })]);
    const tasks = [task("v1", "2026-09-10T12:00:00Z"), task("v1", "2026-09-04T23:30:00Z")];
    expect(roadmapRows(property, tasks, tasks, rule, "UTC")[0].start).toBe("2026-09-04");
    expect(roadmapRows(property, tasks, tasks, rule, "Europe/Berlin")[0].start).toBe("2026-09-05");
  });

  it("leaves out a dated option with no start and no task", () => {
    const property = release([option("v1", { targetAt: "2026-09-30" })]);
    expect(roadmapRows(property, [task("v2", "2026-09-01T00:00:00Z")], [], rule, "UTC")).toEqual(
      [],
    );
  });

  it("fills by the progress of the tasks the filters left", () => {
    const property = release([option("v1", { startAt: "2026-09-01", targetAt: "2026-09-30" })]);
    const all = [
      task("v1", "2026-09-01T00:00:00Z", "o-done"),
      task("v1", "2026-09-01T00:00:00Z"),
      task("v1", "2026-09-01T00:00:00Z"),
      task("v1", "2026-09-01T00:00:00Z", "o-done"),
    ];
    const [row] = roadmapRows(property, all, all.slice(0, 2), rule, "UTC");
    expect([row.done, row.total, row.share]).toEqual([1, 2, 0.5]);
  });

  it("counts by the number property the project names", () => {
    const property = release([option("v1", { startAt: "2026-09-01", targetAt: "2026-09-30" })]);
    const tasks: RoadmapTask[] = [
      {
        ...task("v1", "2026-09-01T00:00:00Z", "o-done"),
        values: { "p-version": "v1", "p-status": "o-done", pts: 3 },
      },
      {
        ...task("v1", "2026-09-01T00:00:00Z"),
        values: { "p-version": "v1", "p-status": "o-todo", pts: 1 },
      },
    ];
    const [row] = roadmapRows(property, tasks, tasks, { ...rule, countBy: "pts" }, "UTC");
    expect([row.done, row.total]).toEqual([3, 4]);
  });

  it("ends a shipped bar on its shipped day, full, and below the open ones", () => {
    const property = release([
      option("v1", { startAt: "2026-08-01", targetAt: "2026-08-31", shippedAt: "2026-09-03" }),
      option("v2", { startAt: "2026-09-01", targetAt: "2026-09-30" }),
    ]);
    const rows = roadmapRows(property, [], [], rule, "UTC");
    expect(rows.map((r) => r.id)).toEqual(["v2", "v1"]);
    expect([rows[1].end, rows[1].share]).toEqual(["2026-09-03", 1]);
  });

  it("draws a start after the end as one day", () => {
    const property = release([option("v1", { startAt: "2026-10-09", targetAt: "2026-10-01" })]);
    const [row] = roadmapRows(property, [], [], rule, "UTC");
    expect([row.start, row.end]).toEqual(["2026-10-01", "2026-10-01"]);
  });
});

describe("a shipped option, whose work the ship archived", () => {
  const property = release([
    option("v1", { targetAt: "2026-09-30", shippedAt: "2026-09-29" }),
    option("v2", { targetAt: "2026-10-31" }),
  ]);
  const archived = { v1: { firstAt: "2026-09-02T10:00:00.000Z", count: 4 } };

  it("starts at its oldest archived task, and says how many it took", () => {
    const [row] = roadmapRows(property, [], [], rule, "UTC", archived);
    expect([row.id, row.start, row.end, row.archived]).toEqual([
      "v1",
      "2026-09-02",
      "2026-09-29",
      4,
    ]);
  });

  it("takes whichever is older, a live task or an archived one", () => {
    const live = [task("v1", "2026-08-20T10:00:00Z")];
    expect(roadmapRows(property, live, live, rule, "UTC", archived)[0].start).toBe("2026-08-20");
  });

  it("is not drawn without them, as before", () => {
    expect(roadmapRows(property, [], [], rule, "UTC")).toEqual([]);
  });
});

describe("roadmapAxis", () => {
  it("is Mondays, from the week before the first day to the week after the last", () => {
    const property = release([option("v1", { startAt: "2026-09-16", targetAt: "2026-09-30" })]);
    const rows = roadmapRows(property, [], [], rule, "UTC");
    const axis = roadmapAxis(rows, "2026-09-20");
    expect(axis.weeks[0]).toBe("2026-09-07");
    expect(axis.weeks.at(-1)).toBe("2026-10-05");
    expect(daysIn(axis, "2026-09-16")).toBe(9);
  });

  it("always holds today", () => {
    const axis = roadmapAxis([], "2026-10-03");
    expect(axis.weeks).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
  });
});
