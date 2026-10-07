import { describe, expect, it } from "vitest";
import { CURRENT_KEY, readFilters } from "../filters";
import { readReleaseBy, releaseToReuse } from "../releases";
import { readSprintBy, sprintToReuse, sprintViews } from "../sprints";
import { NO_VALUE_KEY, type PropertyDTO } from "../types";

/* The Sprint property as the press makes it: a select with no options yet. */
const sprint: PropertyDTO = {
  id: "p-sprint",
  name: "Sprint",
  type: "select",
  position: "X",
  config: {},
  options: [],
};

describe("readSprintBy", () => {
  const props = [
    { id: "p-name", type: "select" },
    { id: "p-it", type: "iteration" },
    { id: "p-it2", type: "iteration" },
  ];

  it("reads the pointer, never a name", () => {
    expect(readSprintBy("p-it2", props)).toBe("p-it2");
    /* A plain select named Sprint is just a select. */
    expect(readSprintBy("p-name", props)).toBeNull();
  });

  it("reads a pointer at a property that is gone as off", () => {
    expect(readSprintBy("p-gone", props)).toBeNull();
    expect(readSprintBy(null, props)).toBeNull();
  });

  it("reuses the pointer, or else the first iteration, so on again makes nothing twice", () => {
    expect(sprintToReuse("p-it2", props)).toBe("p-it2");
    expect(sprintToReuse(null, props)).toBe("p-it");
    expect(sprintToReuse(null, [{ id: "p-name", type: "select" }])).toBeNull();
  });
});

describe("readReleaseBy", () => {
  const props = [
    { id: "p-plain", type: "select", config: {} },
    { id: "p-dated", type: "select", config: { dated: true } },
    { id: "p-it", type: "iteration", config: {} },
  ];

  it("reads a select the pointer names, and nothing else", () => {
    expect(readReleaseBy("p-dated", props)).toBe("p-dated");
    expect(readReleaseBy("p-it", props)).toBeNull();
    expect(readReleaseBy("p-gone", props)).toBeNull();
  });

  it("reuses the pointer, or else the first dated select, never an iteration", () => {
    expect(releaseToReuse("p-plain", props)).toBe("p-plain");
    expect(releaseToReuse(null, props)).toBe("p-dated");
    expect(releaseToReuse(null, [props[0], props[2]])).toBeNull();
  });
});

describe("sprintViews", () => {
  it("makes a board on 'is current' grouped as the main board is, and a list on 'nothing yet'", () => {
    const [board, backlog] = sprintViews("p-sprint", "p-status");
    expect(board).toEqual({
      name: "Sprint",
      kind: "board",
      groupById: "p-status",
      filters: { rules: [{ propertyId: "p-sprint", op: "is", values: [CURRENT_KEY] }] },
    });
    expect(backlog).toEqual({
      name: "Backlog",
      kind: "list",
      groupById: null,
      filters: { rules: [{ propertyId: "p-sprint", op: "is", values: [NO_VALUE_KEY] }] },
    });
  });

  it("groups the board by Sprint when no board says what to group by", () => {
    expect(sprintViews("p-sprint", null)[0].groupById).toBe("p-sprint");
  });

  it("writes rules that a board keeps, though Sprint has no option yet", () => {
    for (const view of sprintViews("p-sprint", "p-status")) {
      expect(readFilters(view.filters, [sprint])).toEqual(view.filters);
    }
  });
});
