import { describe, expect, it } from "vitest";
import { daysIn, optionTasks, roadmapAxis, roadmapRows, type RoadmapTask } from "../roadmap";
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

  it("begins an option with no start the day after the previous dated option's target", () => {
    const property = release([
      option("v1", { startAt: "2026-09-01", targetAt: "2026-09-30" }),
      option("v2"),
      option("v3", { targetAt: "2026-10-31" }),
    ]);
    const rows = roadmapRows(property, [], [], rule, "UTC");
    expect(rows.map((r) => [r.id, r.start, r.end])).toEqual([
      ["v1", "2026-09-01", "2026-09-30"],
      ["v3", "2026-10-01", "2026-10-31"],
    ]);
  });

  it("does not move a bar's start when an old task is moved into the release", () => {
    const property = release([
      option("v2", { targetAt: "2026-09-30" }),
      option("v3", { targetAt: "2026-10-31" }),
    ]);
    const tasks = [task("v2", "2026-09-01T10:00:00Z"), task("v3", "2024-03-01T10:00:00Z")];
    const rows = roadmapRows(property, tasks, tasks, rule, "UTC");
    expect(rows.map((r) => [r.id, r.start])).toEqual([
      ["v2", "2026-09-01"],
      ["v3", "2026-10-01"],
    ]);
    expect(roadmapAxis(rows, "2026-10-07").weeks[0]).toBe("2026-08-24");
  });

  it("starts an option with a start date there, whatever came before it", () => {
    const property = release([
      option("v1", { startAt: "2026-09-01", targetAt: "2026-09-30" }),
      option("v2", { startAt: "2026-09-15", targetAt: "2026-10-31" }),
    ]);
    expect(roadmapRows(property, [], [], rule, "UTC")[1].start).toBe("2026-09-15");
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
  const archived = { v1: { firstAt: "2026-09-02T10:00:00.000Z", count: 4, taskIds: [] } };

  it("starts at its oldest archived task, and says how many it took", () => {
    const row = roadmapRows(property, [], [], rule, "UTC", archived).find((r) => r.id === "v1")!;
    expect([row.id, row.start, row.end, row.archived]).toEqual([
      "v1",
      "2026-09-02",
      "2026-09-29",
      4,
    ]);
  });

  it("takes whichever is older, a live task or an archived one", () => {
    const live = [task("v1", "2026-08-20T10:00:00Z")];
    const rows = roadmapRows(property, live, live, rule, "UTC", archived);
    expect(rows.find((r) => r.id === "v1")?.start).toBe("2026-08-20");
  });

  it("is not drawn without them, while the option after it starts from its target", () => {
    expect(roadmapRows(property, [], [], rule, "UTC").map((r) => r.id)).toEqual(["v2"]);
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

describe("optionTasks", () => {
  const live = [
    { id: "t1", values: { "p-version": "v1" } },
    { id: "t2", values: { "p-version": "v2" } },
    { id: "t3", values: { "p-version": "v1" } },
  ];
  const archived = [
    { id: "a1", key: "R-1" },
    { id: "a2", key: "R-2" },
  ];

  it("keeps the live tasks under the option, in the order it is given", () => {
    const [first, , third] = live;
    expect(optionTasks("p-version", "v1", [third, ...live], [], undefined).live).toEqual([
      third,
      first,
      third,
    ]);
  });

  it("lists the archived ones in the order the board sent, skipping any it lost", () => {
    const under = { firstAt: "2026-09-01T00:00:00Z", count: 3, taskIds: ["a2", "gone", "a1"] };
    expect(optionTasks("p-version", "v1", live, archived, under).archived).toEqual([
      archived[1],
      archived[0],
    ]);
  });

  it("lists no archived task for an option that holds none", () => {
    expect(optionTasks("p-version", "v2", live, archived, undefined).archived).toEqual([]);
  });
});

describe("an iteration on a roadmap", () => {
  it("draws its options as a dated select's", () => {
    const sprints: PropertyDTO = {
      ...release([option("s1", { startAt: "2026-09-01", targetAt: "2026-09-14" }), option("s2")]),
      type: "iteration",
    };
    expect(roadmapRows(sprints, [], [], rule, "UTC").map((r) => r.id)).toEqual(["s1"]);
  });
});
