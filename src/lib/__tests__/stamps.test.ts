import { afterEach, describe, expect, it } from "vitest";
import { buildCard, buildRow, cardItems, readCardView, setCardPlace } from "../card-view";
import { todayIn } from "../day";
import {
  applyFilters,
  CREATED_PROPERTY,
  describeRule,
  opsFor,
  readFilters,
  UPDATED_KEY,
  UPDATED_PROPERTY,
  windowsFor,
} from "../filters";
import { listColumns } from "../list-view";
import { readSort, sortTasks, sortWay } from "../sort";
import type { FilterRule, PropertyDTO, TaskDTO } from "../types";

const DUE: PropertyDTO = {
  id: "p-due",
  name: "Due",
  type: "date",
  position: "V",
  config: {},
  options: [],
};

function task(id: string, createdAt: string, updatedAt: string, position = "V"): TaskDTO {
  return {
    id,
    number: 1,
    key: `USH-${id}`,
    title: id,
    description: "",
    position,
    createdAt,
    updatedAt,
    archivedAt: null,
    values: {},
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    blockedBy: [],
    parts: null,
  };
}

const NONE: ReadonlySet<string> = new Set();

/** A card view somebody arranged before the two days existed. */
const ARRANGED = {
  rows: {
    _key: { place: "headerL", mode: "boxed" },
    _checklist: { place: "footerR", mode: "text" },
    _comments: { place: "footerL", mode: "text" },
    "p-due": { place: "footerL", mode: "text" },
  },
};

function chips(slots: ReturnType<typeof buildCard>) {
  return [
    ...slots.headerL,
    ...slots.headerR,
    ...slots.bodyChips,
    ...slots.footerL,
    ...slots.footerR,
  ];
}

describe("the two days on a card", () => {
  const one = task("a", "2026-09-01T10:00:00.000Z", "2026-10-07T10:00:00.000Z");

  it("are off in a card view somebody already arranged", () => {
    const view = readCardView(ARRANGED, [DUE], null);
    expect(view.rows._created.place).toBe("off");
    expect(view.rows._updated.place).toBe("off");
    const items = cardItems(view, [DUE]);
    expect(chips(buildCard(items, one, [])).map((c) => c.tip)).toEqual(["Task ID · USH-a"]);
    expect(listColumns(items).map((c) => c.id)).not.toContain("_created");
    expect(listColumns(items).map((c) => c.id)).not.toContain("_updated");
  });

  it("are off on a card nobody arranged", () => {
    const view = readCardView(null, [DUE], null);
    expect(view.rows._created.place).toBe("off");
    expect(view.rows._updated.place).toBe("off");
  });

  it("come after the comments", () => {
    const ids = cardItems(readCardView(null, [DUE], null), [DUE]).map((i) => i.id);
    expect(ids.slice(-3)).toEqual(["_comments", "_created", "_updated"]);
  });

  it("show as the day in the project's zone once turned on", () => {
    /* Late in the evening in New York is the next day in UTC. */
    const late = task("b", "2026-10-08T02:30:00.000Z", "2026-10-08T02:30:00.000Z");
    let view = readCardView(ARRANGED, [DUE], null);
    view = setCardPlace(view, "_created", "footerR");
    view = setCardPlace(view, "_updated", "footerR");
    const items = cardItems(view, [DUE]);

    const card = buildCard(items, late, [], [], "America/New_York");
    expect(card.footerR.map((c) => c.tip)).toEqual(["Created · Oct 7", "Updated · Oct 7"]);
    expect(buildCard(items, late, [], [], "UTC").footerR.map((c) => c.text)).toEqual([
      "Oct 8",
      "Oct 8",
    ]);

    const row = buildRow(items, late, [], [], "America/New_York");
    expect(row.cells._created.map((c) => c.text)).toEqual(["Oct 7"]);
    expect(listColumns(items).map((c) => c.id)).toEqual(
      expect.arrayContaining(["_created", "_updated"]),
    );
  });
});

describe("a filter on the two days", () => {
  it("offers on, before, after and within, and never is empty", () => {
    for (const property of [CREATED_PROPERTY, UPDATED_PROPERTY]) {
      expect(opsFor(property)).toEqual(["on", "before", "after", "within"]);
      expect(windowsFor(property)).toEqual(["today", "this_week", "last_7", "last_30"]);
    }
    /* A date property keeps all of them. */
    expect(opsFor(DUE)).toContain("empty");
    expect(windowsFor(DUE)).toContain("next_7");
  });

  it("throws away a saved rule that asks is empty, or looks ahead", () => {
    const saved = {
      rules: [
        { propertyId: UPDATED_KEY, op: "empty" },
        { propertyId: UPDATED_KEY, op: "not_empty" },
        { propertyId: UPDATED_KEY, op: "within", text: "next_7" },
        { propertyId: UPDATED_KEY, op: "within", text: "last_30" },
      ],
    };
    expect(readFilters(saved, [])).toEqual({
      rules: [{ propertyId: UPDATED_KEY, op: "within", text: "last_30" }],
    });
  });

  it("reads as a chip", () => {
    const rule: FilterRule = { propertyId: UPDATED_KEY, op: "within", text: "last_30" };
    expect(describeRule(rule, UPDATED_PROPERTY, [])).toBe("Updated in the last 30 days");
  });
});

describe("Updated within the last 30 days", () => {
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  /* The project sits in Berlin. The window opens on 2026-09-08 there. */
  const TODAY = "2026-10-07";
  const BERLIN = "Europe/Berlin";
  const rule: FilterRule = { propertyId: UPDATED_KEY, op: "within", text: "last_30" };
  const tasks = [
    /* 00:30 on 8 September in Berlin, still 7 September in UTC. */
    task("in", "2026-01-01T00:00:00.000Z", "2026-09-07T22:30:00.000Z"),
    /* 23:30 on 7 September in Berlin. */
    task("out", "2026-01-01T00:00:00.000Z", "2026-09-07T21:30:00.000Z"),
    task("now", "2026-01-01T00:00:00.000Z", "2026-10-07T12:00:00.000Z"),
  ];
  const shown = () =>
    applyFilters(tasks, { rules: [rule] }, [], TODAY, null, NONE, BERLIN).map((t) => t.id);

  it("gives the same answer wherever it runs", () => {
    /* The server, and two browsers on either side of the date line. */
    const answers = ["UTC", "Pacific/Kiritimati", "America/Los_Angeles"].map((where) => {
      process.env.TZ = where;
      return shown();
    });
    expect(answers[0]).toEqual(["in", "now"]);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it("reads the day in the project's zone", () => {
    expect(todayIn(BERLIN, new Date(tasks[0].updatedAt))).toBe("2026-09-08");
    expect(todayIn(BERLIN, new Date(tasks[1].updatedAt))).toBe("2026-09-07");
  });

  it("reads Created by the same rule", () => {
    const made: FilterRule = { propertyId: CREATED_PROPERTY.id, op: "after", text: "2026-09-30" };
    const fresh = task("fresh", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    const old = task("old", "2026-09-30T12:00:00.000Z", "2026-10-01T00:00:00.000Z");
    expect(
      applyFilters([fresh, old], { rules: [made] }, [], TODAY, null, NONE, BERLIN).map((t) => t.id),
    ).toEqual(["fresh"]);
  });
});

describe("a sort by the two days", () => {
  const items = cardItems(readCardView(null, [DUE], null), [DUE]);
  const tasks = [
    task("old", "2026-09-01T10:00:00.000Z", "2026-09-02T10:00:00.000Z", "a"),
    task("just", "2026-09-03T10:00:00.000Z", "2026-10-07T10:00:05.000Z", "b"),
    task("mid", "2026-09-02T10:00:00.000Z", "2026-10-07T10:00:00.000Z", "c"),
  ];

  it("puts the task just changed first, newest first", () => {
    const sort = readSort({ columnId: "_updated", direction: "desc" }, [DUE]);
    expect(sort).toEqual({ columnId: "_updated", direction: "desc" });
    expect(sortTasks(tasks, sort, items, []).map((t) => t.id)).toEqual(["just", "mid", "old"]);
    const updated = items.find((i) => i.id === "_updated")!;
    expect(sortWay(updated, "desc")).toBe("Newest first");
    expect(sortWay(updated, "asc")).toBe("Oldest first");
  });

  it("orders by when a task was made, oldest first", () => {
    const sort = readSort({ columnId: "_created", direction: "asc" }, [DUE]);
    expect(sortTasks(tasks, sort, items, []).map((t) => t.id)).toEqual(["old", "mid", "just"]);
  });
});
