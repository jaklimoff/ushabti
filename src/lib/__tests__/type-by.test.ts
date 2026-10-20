import { describe, expect, it } from "vitest";
import { readTypeBy } from "../when";
import type { PropertyDTO, PropertyOptionDTO } from "../types";

function option(id: string, name: string): PropertyOptionDTO {
  return {
    id,
    name,
    color: "#9aa0aa",
    position: "V",
    startAt: null,
    targetAt: null,
    shippedAt: null,
    note: null,
  };
}

function property(id: string, name: string, extra: Partial<PropertyDTO> = {}): PropertyDTO {
  return { id, name, type: "text", position: "V", config: {}, options: [], ...extra };
}

const type = property("p-type", "Type", {
  type: "select",
  options: [option("o-bug", "Bug"), option("o-story", "Story"), option("o-chore", "Chore")],
});
const area = property("p-area", "Area", { type: "select", options: [option("o-ui", "UI")] });
const sprint = property("p-sprint", "Sprint", { type: "iteration" });
const tags = property("p-tags", "Tags", { type: "multi_select" });
const points = property("p-points", "Points", { type: "number" });

describe("the select a project names as its Type", () => {
  const all = [type, area, sprint, tags, points];

  it("reads a select and an iteration", () => {
    expect(readTypeBy("p-type", all)).toBe("p-type");
    expect(readTypeBy("p-sprint", all)).toBe("p-sprint");
  });

  it("reads a deleted property, a property of another type and junk as none", () => {
    expect(readTypeBy("p-gone", all)).toBeNull();
    expect(readTypeBy("p-tags", all)).toBeNull();
    expect(readTypeBy("p-points", all)).toBeNull();
    expect(readTypeBy(null, all)).toBeNull();
    expect(readTypeBy(7, all)).toBeNull();
  });
});
