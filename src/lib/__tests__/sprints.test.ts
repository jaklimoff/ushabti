import { describe, expect, it } from "vitest";
import { CURRENT_KEY, readFilters } from "../filters";
import { sprintsSetUp, sprintViews } from "../sprints";
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

describe("sprintsSetUp", () => {
  it("is true once a property named Sprint exists, in any letter case", () => {
    expect(sprintsSetUp([{ name: "Status" }, { name: "Sprint" }])).toBe(true);
    expect(sprintsSetUp([{ name: " sprint " }])).toBe(true);
  });

  it("is false without one", () => {
    expect(sprintsSetUp([])).toBe(false);
    expect(sprintsSetUp([{ name: "Sprints" }, { name: "Status" }])).toBe(false);
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
