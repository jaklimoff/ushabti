import { describe, expect, it } from "vitest";
import { isShown, readWhen, readWhens, whenSaid } from "../when";
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

const type: PropertyDTO = {
  id: "p-type",
  name: "Type",
  type: "select",
  position: "V",
  config: {},
  options: [option("o-bug", "Bug"), option("o-story", "Story"), option("o-chore", "Chore")],
};

const sprint: PropertyDTO = {
  id: "p-sprint",
  name: "Sprint",
  type: "iteration",
  position: "W",
  config: {},
  options: [option("o-s1", "Sprint 1")],
};

const tags: PropertyDTO = {
  id: "p-tags",
  name: "Tags",
  type: "multi_select",
  position: "X",
  config: {},
  options: [option("o-ui", "UI")],
};

const severity: PropertyDTO = {
  id: "p-sev",
  name: "Severity",
  type: "text",
  position: "Y",
  config: {},
  options: [],
};

const all = [type, sprint, tags, severity];

describe("reading when a property shows", () => {
  it("reads a select and a set of its options", () => {
    expect(readWhen({ propertyId: "p-type", optionIds: ["o-bug"] }, all, "p-sev")).toEqual({
      propertyId: "p-type",
      optionIds: ["o-bug"],
    });
  });

  it("reads an iteration as a select", () => {
    expect(readWhen({ propertyId: "p-sprint", optionIds: ["o-s1"] }, all, "p-sev")).toEqual({
      propertyId: "p-sprint",
      optionIds: ["o-s1"],
    });
  });

  it("keeps nothing yet in the set", () => {
    expect(
      readWhen({ propertyId: "p-type", optionIds: [NO_VALUE_KEY, "o-bug"] }, all, "p-sev"),
    ).toEqual({ propertyId: "p-type", optionIds: [NO_VALUE_KEY, "o-bug"] });
  });

  it("reads a deleted property as always shown", () => {
    expect(readWhen({ propertyId: "p-gone", optionIds: ["o-bug"] }, all, "p-sev")).toBeNull();
  });

  it("reads a property that is not a single select as always shown", () => {
    expect(readWhen({ propertyId: "p-tags", optionIds: ["o-ui"] }, all, "p-sev")).toBeNull();
    expect(readWhen({ propertyId: "p-sev", optionIds: [NO_VALUE_KEY] }, all, "p-type")).toBeNull();
  });

  it("reads the property itself as always shown", () => {
    expect(readWhen({ propertyId: "p-type", optionIds: ["o-bug"] }, all, "p-type")).toBeNull();
  });

  it("reads an empty set as always shown", () => {
    expect(readWhen({ propertyId: "p-type", optionIds: [] }, all, "p-sev")).toBeNull();
  });

  it("drops deleted options, and an empty set after that is always shown", () => {
    expect(
      readWhen({ propertyId: "p-type", optionIds: ["o-gone", "o-bug"] }, all, "p-sev"),
    ).toEqual({ propertyId: "p-type", optionIds: ["o-bug"] });
    expect(readWhen({ propertyId: "p-type", optionIds: ["o-gone"] }, all, "p-sev")).toBeNull();
  });

  it("reads anything else as always shown", () => {
    for (const raw of [null, undefined, "p-type", 4, { propertyId: "p-type" }, { optionIds: [] }]) {
      expect(readWhen(raw, all, "p-sev")).toBeNull();
    }
    expect(readWhen({ propertyId: "p-type", optionIds: "o-bug" }, all, "p-sev")).toBeNull();
  });

  it("keeps each option once", () => {
    expect(readWhen({ propertyId: "p-type", optionIds: ["o-bug", "o-bug"] }, all, "p-sev")).toEqual(
      { propertyId: "p-type", optionIds: ["o-bug"] },
    );
  });

  it("reads every property's when afresh and keeps the rest of its config", () => {
    const raw: PropertyDTO = {
      ...severity,
      config: { dated: true, when: { propertyId: "p-type", optionIds: ["o-gone", "o-bug"] } },
    };
    const gone: PropertyDTO = {
      ...severity,
      id: "p-other",
      config: { when: { propertyId: "p-gone", optionIds: ["o-bug"] } },
    };
    const [, , , read, other] = readWhens([type, sprint, tags, raw, gone]);
    expect(read.config).toEqual({
      dated: true,
      when: { propertyId: "p-type", optionIds: ["o-bug"] },
    });
    expect(other.config).toEqual({});
  });
});

describe("two rules that point at each other", () => {
  /* Type shown when Kind is A, Kind shown when Type is Bug: a task with
     neither value could never show either, so neither could be set. */
  const kind: PropertyDTO = {
    ...type,
    id: "p-kind",
    name: "Kind",
    options: [option("o-a", "A")],
    config: { when: { propertyId: "p-type", optionIds: ["o-bug"] } },
  };
  const ruledType: PropertyDTO = {
    ...type,
    config: { when: { propertyId: "p-kind", optionIds: ["o-a"] } },
  };

  it("read as always shown, both of them", () => {
    const read = readWhens([ruledType, kind, severity]);
    expect(read[0].config.when).toBeUndefined();
    expect(read[1].config.when).toBeUndefined();
  });

  it("leave a chain alone, because its first select always shows", () => {
    const sev: PropertyDTO = {
      ...severity,
      config: { when: { propertyId: "p-kind", optionIds: ["o-a"] } },
    };
    const read = readWhens([type, kind, sev]);
    expect(read[1].config.when).toEqual({ propertyId: "p-type", optionIds: ["o-bug"] });
    expect(read[2].config.when).toEqual({ propertyId: "p-kind", optionIds: ["o-a"] });
  });

  it("break a longer circle too", () => {
    const sev: PropertyDTO = {
      ...severity,
      type: "select",
      options: [option("o-high", "High")],
      config: { when: { propertyId: "p-kind", optionIds: ["o-a"] } },
    };
    const looped: PropertyDTO = {
      ...type,
      config: { when: { propertyId: "p-sev", optionIds: ["o-high"] } },
    };
    const read = readWhens([looped, kind, sev]);
    expect(read.map((p) => p.config.when)).toEqual([undefined, undefined, undefined]);
  });
});

describe("whether a property shows for a task", () => {
  const sev: PropertyDTO = {
    ...severity,
    config: { when: { propertyId: "p-type", optionIds: ["o-bug"] } },
  };

  it("shows a property with no rule", () => {
    expect(isShown(severity, {}, all)).toBe(true);
  });

  it("shows it when the task's value is in the set", () => {
    expect(isShown(sev, { "p-type": "o-bug" }, all)).toBe(true);
  });

  it("hides it when the task's value is not in the set", () => {
    expect(isShown(sev, { "p-type": "o-story" }, all)).toBe(false);
    expect(isShown(sev, {}, all)).toBe(false);
  });

  it("reads an empty value as nothing yet", () => {
    const either: PropertyDTO = {
      ...severity,
      config: { when: { propertyId: "p-type", optionIds: ["o-bug", NO_VALUE_KEY] } },
    };
    expect(isShown(either, {}, all)).toBe(true);
    expect(isShown(either, { "p-type": null }, all)).toBe(true);
    expect(isShown(either, { "p-type": "o-story" }, all)).toBe(false);
  });

  it("hides the end of a chain when the select in the middle is hidden", () => {
    const level: PropertyDTO = {
      id: "p-level",
      name: "Level",
      type: "select",
      position: "Z",
      config: { when: { propertyId: "p-type", optionIds: ["o-bug"] } },
      options: [option("o-high", "High"), option("o-low", "Low")],
    };
    const repro: PropertyDTO = {
      ...severity,
      id: "p-repro",
      name: "Repro",
      config: { when: { propertyId: "p-level", optionIds: ["o-high"] } },
    };
    const chain = readWhens([type, level, repro]);
    const [, readLevel, readRepro] = chain;
    expect(isShown(readRepro, { "p-type": "o-bug", "p-level": "o-high" }, chain)).toBe(true);
    expect(isShown(readLevel, { "p-type": "o-story", "p-level": "o-high" }, chain)).toBe(false);
    expect(isShown(readRepro, { "p-type": "o-story", "p-level": "o-high" }, chain)).toBe(false);
  });
});

describe("the rule in words", () => {
  it("names the select and its options", () => {
    expect(whenSaid({ propertyId: "p-type", optionIds: ["o-bug", "o-story"] }, all)).toBe(
      "Shown when Type is Bug or Story",
    );
  });

  it("names nothing yet as the filter does", () => {
    expect(whenSaid({ propertyId: "p-type", optionIds: [NO_VALUE_KEY] }, all)).toBe(
      "Shown when Type is No type",
    );
  });
});
