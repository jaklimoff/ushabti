import { describe, expect, it } from "vitest";
import { isOver } from "../links";
import {
  changeAsked,
  droppedBy,
  droppedSaid,
  hidBy,
  hiddenOf,
  pickedAsked,
  pickedDrops,
  readWhens,
  ruleAsked,
  ruleDrops,
  withoutHidden,
} from "../when";
import type { PropertyDTO, PropertyOptionDTO, TaskValue } from "../types";

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
  options: [option("o-bug", "Bug"), option("o-story", "Story")],
};

const bugOnly = { when: { propertyId: "p-type", optionIds: ["o-bug"] } };

const severity: PropertyDTO = {
  id: "p-sev",
  name: "Severity",
  type: "text",
  position: "W",
  config: bugOnly,
  options: [],
};

const repro: PropertyDTO = { ...severity, id: "p-repro", name: "Repro", position: "X" };

const status: PropertyDTO = {
  id: "p-status",
  name: "Status",
  type: "select",
  position: "Y",
  config: bugOnly,
  options: [option("o-todo", "To do"), option("o-done", "Done")],
};

const all = readWhens([type, severity, repro, status]);

const bug = { "p-type": "o-bug", "p-sev": "High", "p-repro": "Click it", "p-status": "o-done" };

describe("values a task does not show", () => {
  it("finds nothing while the type shows them all", () => {
    expect(hiddenOf(bug, all)).toEqual([]);
  });

  it("names what a change of type takes away", () => {
    expect(droppedBy(bug, all, "p-type", "o-story").map((p) => p.name)).toEqual([
      "Severity",
      "Repro",
      "Status",
    ]);
  });

  it("does not count an empty value as one that goes", () => {
    const lost = droppedBy({ ...bug, "p-repro": "", "p-status": null }, all, "p-type", "o-story");
    expect(lost.map((p) => p.name)).toEqual(["Severity"]);
  });

  it("takes away every row that does not show, empty or not", () => {
    const story = { ...bug, "p-type": "o-story", "p-repro": null };
    expect(withoutHidden(story, all)).toEqual({ "p-type": "o-story" });
  });

  it("keeps a value whose property it does not know", () => {
    expect(withoutHidden({ "p-gone": "x" }, all)).toEqual({ "p-gone": "x" });
  });

  it("names the option that hid them", () => {
    const story = { ...bug, "p-type": "o-story" };
    expect(hidBy(story, all, hiddenOf(story, all))).toBe("Story");
    const none = { ...bug, "p-type": null };
    expect(hidBy(none, all, hiddenOf(none, all))).toBeNull();
  });

  it("names the option up the chain, and nothing when two options hid them", () => {
    const kind: PropertyDTO = {
      ...type,
      id: "p-kind",
      name: "Kind",
      config: {},
      options: [option("o-a", "A"), option("o-b", "B")],
    };
    const typed: PropertyDTO = {
      ...type,
      config: { when: { propertyId: "p-kind", optionIds: ["o-a"] } },
    };
    const chained = readWhens([kind, typed, severity]);
    const values = { "p-kind": "o-b", "p-type": "o-bug", "p-sev": "High" };
    const lost = hiddenOf(values, chained);
    expect(lost.map((p) => p.name)).toEqual(["Type", "Severity"]);
    expect(hidBy(values, chained, lost)).toBe("B");

    const steps: PropertyDTO = {
      ...severity,
      id: "p-steps",
      name: "Steps",
      config: { when: { propertyId: "p-kind", optionIds: ["o-a"] } },
    };
    const two = readWhens([kind, type, severity, steps]);
    const both = { "p-kind": "o-b", "p-type": "o-story", "p-sev": "High", "p-steps": "1" };
    expect(hidBy(both, two, hiddenOf(both, two))).toBeNull();
  });
});

describe("a hidden Done closes nothing", () => {
  it("is over as a bug, and not over once the type changes", () => {
    const doneWhen = { propertyId: "p-status", optionId: "o-done" };
    expect(isOver({ archivedAt: null, values: bug }, doneWhen)).toBe(true);
    const story = withoutHidden({ ...bug, "p-type": "o-story" }, all);
    expect(isOver({ archivedAt: null, values: story }, doneWhen)).toBe(false);
  });
});

describe("the questions", () => {
  it("asks in the panel with the names", () => {
    const lost = droppedBy({ ...bug, "p-status": null }, all, "p-type", "o-story");
    expect(changeAsked(type, "o-story", lost)).toBe(
      "Change Type to Story? Severity and Repro lose their values.",
    );
    expect(changeAsked(type, null, lost.slice(0, 1))).toBe(
      "Change Type to nothing? Severity loses its value.",
    );
  });

  it("asks on a bulk set with the counts", () => {
    const tasks: { values: Record<string, TaskValue> }[] = [
      { values: { ...bug, "p-status": null } },
      { values: { "p-type": "o-bug", "p-sev": "Low" } },
      { values: { "p-type": "o-story" } },
      { values: {} },
    ];
    const drops = pickedDrops(tasks, all, "p-type", "o-story");
    expect(drops).toEqual({ values: 3, names: ["Severity", "Repro"] });
    expect(pickedAsked(type, "o-story", 4, drops)).toBe(
      "Set Type to Story on 4 tasks? 3 values go (Severity, Repro).",
    );
  });

  it("asks nothing on a bulk set that drops nothing", () => {
    expect(pickedDrops([{ values: bug }], all, "p-type", "o-bug").values).toBe(0);
  });

  it("counts the tasks a new rule takes a value from", () => {
    const plain = readWhens([type, { ...severity, config: {} }]);
    const tasks: { values: Record<string, TaskValue> }[] = [
      { values: { "p-type": "o-story", "p-sev": "High" } },
      { values: { "p-type": "o-bug", "p-sev": "Low" } },
      { values: { "p-type": "o-story" } },
    ];
    const drops = ruleDrops(tasks, plain, "p-sev", { propertyId: "p-type", optionIds: ["o-bug"] });
    expect(drops).toEqual({ tasks: 1, names: ["Severity"] });
    expect(ruleAsked(drops)).toBe("1 task loses its Severity");
    expect(ruleAsked({ tasks: 12, names: ["Severity"] })).toBe("12 tasks lose their Severity");
    expect(ruleDrops(tasks, plain, "p-sev", null).tasks).toBe(0);
  });

  it("says in the activity what went", () => {
    expect(droppedSaid("Story", ["Severity", "Repro"])).toBe(
      "Story hid Severity and Repro, and their values were dropped",
    );
    expect(droppedSaid(null, ["Severity"])).toBe("Severity was hidden, and its value was dropped");
  });
});
