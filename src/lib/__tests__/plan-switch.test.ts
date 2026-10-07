import { describe, expect, it } from "vitest";
import { offQuestion } from "../plan-switch";

const sprint = { id: "p-s", name: "Sprint", options: [{}, {}] as never[] };

describe("offQuestion", () => {
  it("names what stays in real numbers", () => {
    const tasks = [
      { values: { "p-s": "o1" } },
      { values: { "p-s": "o2" } },
      { values: {} },
    ] as never[];
    const views = [
      { groupById: "p-status", filters: { rules: [{ propertyId: "p-s" }] } },
      { groupById: null, filters: { rules: [{ propertyId: "p-s" }] } },
      { groupById: "p-status", filters: { rules: [] } },
    ] as never[];
    expect(offQuestion("sprint", sprint, tasks, views)).toBe(
      "Turn sprints off? Nothing is deleted: Sprint keeps its 2 sprints, 2 tasks keep their sprint, and 2 views stay.",
    );
  });

  it("says one as one, and none as none", () => {
    const release = { id: "p-r", name: "Release", options: [{}] as never[] };
    const views = [{ groupById: "p-r", filters: { rules: [] } }] as never[];
    expect(offQuestion("release", release, [{ values: { "p-r": null } }], views)).toBe(
      "Turn releases off? Nothing is deleted: Release keeps its 1 release, no task holds a release, and 1 view stays.",
    );
  });
});
