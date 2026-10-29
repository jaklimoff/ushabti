import { describe, expect, it } from "vitest";
import {
  daysIn,
  daysLate,
  movedTarget,
  nextStart,
  optionTasks,
  readyToShip,
  roadmapAxis,
  roadmapMonths,
  roadmapRows,
  roadmapState,
  type RoadmapRow,
  type RoadmapTask,
  weekLines,
} from "../roadmap";
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

const rule = { doneWhen: { propertyId: "p-status", optionIds: ["o-done"] }, countBy: null };

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

  it("starts a dated option with no start and no task today, or at its target if sooner", () => {
    const property = release([option("v1", { targetAt: "2026-09-30" })]);
    const tasks = [task("v2", "2026-09-01T00:00:00Z")];
    const [row] = roadmapRows(property, tasks, [], rule, "UTC", {}, "2026-09-10");
    expect([row.start, row.end]).toEqual(["2026-09-10", "2026-09-30"]);
    const [late] = roadmapRows(property, tasks, [], rule, "UTC", {}, "2026-10-10");
    expect([late.start, late.end]).toEqual(["2026-09-30", "2026-09-30"]);
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

  it("is one day on its ship day without them, and the option after it starts from its target", () => {
    const rows = roadmapRows(property, [], [], rule, "UTC", {}, "2026-10-14");
    expect(rows.map((r) => [r.id, r.start, r.end])).toEqual([
      ["v2", "2026-10-01", "2026-10-31"],
      ["v1", "2026-09-29", "2026-09-29"],
    ]);
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

describe("a short plan on a wide screen", () => {
  it("is given weeks at the end, and keeps its first Monday", () => {
    const axis = roadmapAxis([], "2026-10-03", 8);
    expect(axis.weeks[0]).toBe("2026-09-21");
    expect(axis.weeks).toHaveLength(8);
  });

  it("is never cut to fit", () => {
    expect(roadmapAxis([], "2026-10-03", 1).weeks).toHaveLength(3);
  });
});

describe("roadmapMonths", () => {
  it("puts each month on its true first day, and says the year first and in January", () => {
    const axis = roadmapAxis([{ start: "2026-11-20", end: "2027-01-10" }], "2026-11-20");
    const months = roadmapMonths(axis);
    expect(months.map((m) => [m.name, m.year, m.sayYear])).toEqual([
      ["Nov", 2026, true],
      ["Dec", 2026, false],
      ["Jan", 2027, true],
    ]);
    expect(months[1].at).toBe(daysIn(axis, "2026-12-01"));
    // The first month began before the axis did, so only its days on it count.
    expect(months[0].at).toBeLessThan(0);
    expect(months[0].days).toBe(daysIn(axis, "2026-12-01"));
    expect(months.reduce((sum, m) => sum + m.days, 0)).toBe(axis.weeks.length * 7);
  });
});

describe("roadmapState", () => {
  const row = (dates: Partial<RoadmapRow>): RoadmapRow => ({
    id: "v1",
    name: "v1",
    color: "#4b8fbe",
    start: "2026-09-01",
    end: "2026-10-20",
    targetAt: "2026-10-20",
    shippedAt: null,
    done: 0,
    total: 4,
    share: 0,
    archived: 0,
    ...dates,
  });

  it("is ended once the target passed unshipped, and ready to ship", () => {
    expect(roadmapState(row({}), "2026-10-21")).toEqual({ kind: "ended" });
    expect(readyToShip(row({}), "2026-10-21")).toBe(true);
  });

  it("is late inside a week with work open, and not once the work is done", () => {
    expect(roadmapState(row({}), "2026-10-17")).toEqual({ kind: "late", daysLeft: 3 });
    expect(roadmapState(row({}), "2026-10-20")).toEqual({ kind: "late", daysLeft: 0 });
    expect(roadmapState(row({ done: 4, share: 1 }), "2026-10-17")).toEqual({ kind: "open" });
    expect(roadmapState(row({}), "2026-10-12")).toEqual({ kind: "open" });
  });

  it("is ready when every task is over, and never once shipped", () => {
    expect(readyToShip(row({ done: 4, share: 1 }), "2026-10-01")).toBe(true);
    expect(readyToShip(row({ done: 0, total: 0 }), "2026-10-01")).toBe(false);
    const shipped = row({ shippedAt: "2026-10-19", end: "2026-10-19", share: 1 });
    expect(roadmapState(shipped, "2026-11-01")).toEqual({ kind: "shipped" });
    expect(readyToShip(shipped, "2026-11-01")).toBe(false);
  });
});

describe("movedTarget", () => {
  const row = (dates: Partial<RoadmapRow>): RoadmapRow => ({
    id: "v1",
    name: "v1",
    color: "#4b8fbe",
    start: "2026-10-01",
    end: "2026-10-20",
    targetAt: "2026-10-20",
    shippedAt: null,
    done: 0,
    total: 0,
    share: 0,
    archived: 0,
    ...dates,
  });

  it("moves the target by whole days, across a month", () => {
    expect(movedTarget(row({}), 3)).toBe("2026-10-23");
    expect(movedTarget(row({}), 12)).toBe("2026-11-01");
    expect(movedTarget(row({}), -5)).toBe("2026-10-15");
  });

  it("stops at the bar's first day, which the PATCH refuses to pass", () => {
    expect(movedTarget(row({}), -40)).toBe("2026-10-01");
  });

  it("never pushes to its start a target already before a start worked out past it", () => {
    const late = row({ start: "2026-10-25" });
    expect(movedTarget(late, -1)).toBe("2026-10-19");
    expect(movedTarget(late, 2)).toBe("2026-10-22");
  });
});

describe("nextStart", () => {
  it("starts the day after the last dated option, or today", () => {
    const property = release([option("v1", { targetAt: "2026-09-30" }), option("v2")]);
    expect(nextStart(property, "2026-10-17")).toBe("2026-10-01");
    expect(nextStart(release([option("v1")]), "2026-10-17")).toBe("2026-10-17");
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

describe("a shipped release's slip", () => {
  it("counts the days it shipped after its target", () => {
    expect(daysLate({ targetAt: "2026-10-16", shippedAt: "2026-10-28" })).toBe(12);
  });

  it("is nothing for one shipped early, on the day, or not shipped", () => {
    expect(daysLate({ targetAt: "2026-10-16", shippedAt: "2026-10-10" })).toBe(0);
    expect(daysLate({ targetAt: "2026-10-16", shippedAt: "2026-10-16" })).toBe(0);
    expect(daysLate({ targetAt: "2026-10-16", shippedAt: null })).toBe(0);
  });
});

describe("the week lines", () => {
  it("drops a week line a month line stands within three days of", () => {
    // Mondays from Oct 19: Oct 26, Nov 2 (a day after Nov 1), Nov 30 (a day before Dec 1).
    const axis = roadmapAxis([{ start: "2026-10-26", end: "2026-12-07" }], "2026-10-28");
    const kept = weekLines(axis, roadmapMonths(axis));
    const dropped = axis.weeks.filter((_, i) => !kept[i]);
    expect(dropped).toEqual(["2026-11-02", "2026-11-30"]);
  });
});
