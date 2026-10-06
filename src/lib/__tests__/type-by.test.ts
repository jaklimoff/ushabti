import { describe, expect, it } from "vitest";
import { readTypeBy, readWhens, typeSheet } from "../when";
import { NO_VALUE_KEY, type PropertyDTO, type PropertyOptionDTO } from "../types";

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

describe("what one type shows", () => {
  const rule = (propertyId: string, optionIds: string[]) => ({
    config: { when: { propertyId, optionIds } },
  });
  const all = readWhens([
    type,
    area,
    property("p-title2", "Notes"),
    property("p-sev", "Severity", rule("p-type", ["o-bug"])),
    property("p-repro", "Repro", rule("p-type", ["o-bug", "o-story", NO_VALUE_KEY])),
    property("p-ac", "Acceptance", rule("p-type", ["o-story"])),
    property("p-shot", "Screenshot", rule("p-area", ["o-ui"])),
    property("p-lost", "Lost", rule("p-gone", ["o-x"])),
  ]);
  const names = (list: { name: string }[]) => list.map((p) => p.name);

  it("puts a property with no rule, or one that does not hold, on every type", () => {
    const sheet = typeSheet(all, "p-type", "o-bug");
    expect(names(sheet.every)).toEqual(["Area", "Notes", "Lost"]);
  });

  it("puts a property ruled by the Type on this type, and says which others it is on", () => {
    const sheet = typeSheet(all, "p-type", "o-bug");
    expect(sheet.here.map((r) => [r.property.name, r.also])).toEqual([
      ["Severity", []],
      ["Repro", ["Story"]],
    ]);
    expect(sheet.elsewhere.map((r) => [r.property.name, r.also])).toEqual([
      ["Acceptance", ["Story"]],
    ]);
  });

  it("lists a property ruled by another select with its rule in words", () => {
    const sheet = typeSheet(all, "p-type", "o-bug");
    expect(sheet.ruledBy.map((r) => [r.property.name, r.said])).toEqual([
      ["Screenshot", "Shown when Area is UI"],
    ]);
  });

  it("never lists the Type select itself", () => {
    const sheet = typeSheet(all, "p-type", "o-chore");
    const every = names(sheet.every);
    expect(every).not.toContain("Type");
    expect(sheet.here).toEqual([]);
  });
});
