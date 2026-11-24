import { describe, expect, it } from "vitest";
import { copySetup, setupLine, summarize, type Setup, type SetupSummary } from "../setup-copy";

/*
 * The setup of one project, copied for a new one: every id it names becomes
 * the new id, and the options of a dated property stay behind.
 */

function source(): Setup & { project: Setup["project"] & { name: string } } {
  return {
    project: {
      name: "Ushabti roadmap",
      cardView: {
        rows: {
          _key: { place: "top", mode: "text" },
          status: { place: "off", mode: "text" },
          typ: { place: "edge", mode: "colour" },
        },
      },
      doneWhen: { propertyId: "status", optionIds: ["done"] },
      progressBy: "estimate",
      typeBy: "typ",
      releaseBy: "version",
      sprintBy: null,
      agentRules: "Move the card to Review when you finish.",
    },
    properties: [
      { id: "status", name: "Status", type: "select", position: "a0", config: {} },
      { id: "typ", name: "Type", type: "select", position: "a1", config: {} },
      {
        id: "severity",
        name: "Severity",
        type: "select",
        position: "a2",
        config: {
          when: { propertyId: "typ", optionIds: ["bug"] },
          defaults: { bug: "minor" },
        },
      },
      { id: "estimate", name: "Estimate", type: "number", position: "a3", config: {} },
      { id: "version", name: "Version", type: "select", position: "a4", config: { dated: true } },
      { id: "sprint", name: "Sprint", type: "iteration", position: "a5", config: {} },
      { id: "start", name: "Start", type: "date", position: "a6", config: {} },
      { id: "end", name: "End", type: "date", position: "a7", config: {} },
    ],
    options: [
      {
        id: "todo",
        propertyId: "status",
        name: "To pick",
        color: "#111111",
        icon: null,
        position: "a0",
      },
      {
        id: "done",
        propertyId: "status",
        name: "Done",
        color: "#222222",
        icon: "Check",
        position: "a1",
      },
      { id: "bug", propertyId: "typ", name: "Bug", color: "#333333", icon: null, position: "a0" },
      {
        id: "minor",
        propertyId: "severity",
        name: "Minor",
        color: "#444444",
        icon: null,
        position: "a0",
      },
      {
        id: "v1",
        propertyId: "version",
        name: "0.1",
        color: "#555555",
        icon: null,
        position: "a0",
      },
      { id: "s1", propertyId: "sprint", name: "S1", color: "#666666", icon: null, position: "a0" },
    ],
    views: [
      {
        name: "Board",
        kind: "board",
        groupById: "status",
        position: "a0",
        isDefault: true,
        config: {
          startFolded: ["done"],
          filters: { rules: [{ propertyId: "typ", op: "is", values: ["bug", "__none__"] }] },
          sort: { columnId: "estimate", direction: "desc" },
        },
        cardView: null,
      },
      {
        name: "Releases",
        kind: "roadmap",
        groupById: "version",
        position: "a1",
        isDefault: false,
        config: {
          startFolded: ["v1"],
          filters: {
            rules: [
              { propertyId: "version", op: "is", values: ["v1"] },
              { propertyId: "sprint", op: "is", values: ["s1", "__none__"] },
            ],
          },
        },
        cardView: { rows: { version: { place: "foot", mode: "text" } } },
      },
      {
        name: "Timeline",
        kind: "timeline",
        groupById: null,
        position: "a2",
        isDefault: false,
        config: { dates: { startBy: "start", endBy: "end" }, sort: { columnId: "_title" } },
        cardView: null,
      },
    ],
  };
}

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

const OLD = new Set([
  "status",
  "typ",
  "severity",
  "estimate",
  "version",
  "sprint",
  "start",
  "end",
  "todo",
  "done",
  "bug",
  "minor",
  "v1",
  "s1",
]);

/** Every string anywhere in a value, keys too. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [k, ...strings(v)]);
  }
  return [];
}

describe("copySetup", () => {
  it("makes every property new, with its name, type, order and config", () => {
    const copy = copySetup(source(), counter());
    expect(copy.properties.map((p) => [p.name, p.type, p.position])).toEqual([
      ["Status", "select", "a0"],
      ["Type", "select", "a1"],
      ["Severity", "select", "a2"],
      ["Estimate", "number", "a3"],
      ["Version", "select", "a4"],
      ["Sprint", "iteration", "a5"],
      ["Start", "date", "a6"],
      ["End", "date", "a7"],
    ]);
    expect(copy.properties.every((p) => p.id.startsWith("new-"))).toBe(true);
    expect(copy.properties.find((p) => p.name === "Version")!.config).toEqual({ dated: true });
  });

  it("copies the options of a plain select, with their colour, icon and order", () => {
    const copy = copySetup(source(), counter());
    const status = copy.properties.find((p) => p.name === "Status")!;
    expect(
      copy.options
        .filter((o) => o.propertyId === status.id)
        .map(({ name, color, icon, position }) => ({ name, color, icon, position })),
    ).toEqual([
      { name: "To pick", color: "#111111", icon: null, position: "a0" },
      { name: "Done", color: "#222222", icon: "Check", position: "a1" },
    ]);
  });

  it("leaves the options of a dated select and an iteration behind", () => {
    const copy = copySetup(source(), counter());
    const version = copy.properties.find((p) => p.name === "Version")!;
    const sprint = copy.properties.find((p) => p.name === "Sprint")!;
    expect(copy.options.filter((o) => o.propertyId === version.id)).toEqual([]);
    expect(copy.options.filter((o) => o.propertyId === sprint.id)).toEqual([]);
    expect(copy.options.map((o) => o.name)).toEqual(["To pick", "Done", "Bug", "Minor"]);
  });

  it("points the project's card, done rule and pointers at the new ids", () => {
    const copy = copySetup(source(), counter());
    const id = (name: string) => copy.properties.find((p) => p.name === name)!.id;
    const option = (name: string) => copy.options.find((o) => o.name === name)!.id;
    expect(copy.project).toEqual({
      cardView: {
        rows: {
          _key: { place: "top", mode: "text" },
          [id("Status")]: { place: "off", mode: "text" },
          [id("Type")]: { place: "edge", mode: "colour" },
        },
      },
      doneWhen: { propertyId: id("Status"), optionIds: [option("Done")] },
      progressBy: id("Estimate"),
      typeBy: id("Type"),
      releaseBy: id("Version"),
      sprintBy: null,
      agentRules: "Move the card to Review when you finish.",
    });
  });

  it("maps a property's own rules: shown when, and what a type starts with", () => {
    const copy = copySetup(source(), counter());
    const severity = copy.properties.find((p) => p.name === "Severity")!;
    const id = (name: string) => copy.properties.find((p) => p.name === name)!.id;
    const option = (name: string) => copy.options.find((o) => o.name === name)!.id;
    expect(severity.config).toEqual({
      when: { propertyId: id("Type"), optionIds: [option("Bug")] },
      defaults: { [option("Bug")]: option("Minor") },
    });
  });

  it("copies every view with its kind, order, main flag, grouping, config and card", () => {
    const copy = copySetup(source(), counter());
    const id = (name: string) => copy.properties.find((p) => p.name === name)!.id;
    const option = (name: string) => copy.options.find((o) => o.name === name)!.id;
    expect(copy.views).toEqual([
      {
        name: "Board",
        kind: "board",
        groupById: id("Status"),
        position: "a0",
        isDefault: true,
        config: {
          startFolded: [option("Done")],
          filters: {
            rules: [{ propertyId: id("Type"), op: "is", values: [option("Bug"), "__none__"] }],
          },
          sort: { columnId: id("Estimate"), direction: "desc" },
        },
        cardView: null,
      },
      {
        name: "Releases",
        kind: "roadmap",
        groupById: id("Version"),
        position: "a1",
        isDefault: false,
        /* The rule that named only a version goes; the sprint's keeps Nothing yet. */
        config: {
          startFolded: [],
          filters: { rules: [{ propertyId: id("Sprint"), op: "is", values: ["__none__"] }] },
        },
        cardView: { rows: { [id("Version")]: { place: "foot", mode: "text" } } },
      },
      {
        name: "Timeline",
        kind: "timeline",
        groupById: null,
        position: "a2",
        isDefault: false,
        config: { dates: { startBy: id("Start"), endBy: id("End") }, sort: { columnId: "_title" } },
        cardView: null,
      },
    ]);
  });

  it("names no id of the source anywhere", () => {
    const copy = copySetup(source(), counter());
    expect(strings(copy).filter((s) => OLD.has(s))).toEqual([]);
  });

  it("drops a done rule that named only a left-out option", () => {
    const s = source();
    s.project.doneWhen = { propertyId: "version", optionIds: ["v1"] };
    expect(copySetup(s, counter()).project.doneWhen).toBeNull();
  });

  it("drops a pointer that names a property the source no longer has", () => {
    const s = source();
    s.project.typeBy = "gone";
    s.project.sprintBy = "sprint";
    const copy = copySetup(s, counter());
    expect(copy.project.typeBy).toBeNull();
    expect(copy.project.sprintBy).toBe(copy.properties.find((p) => p.name === "Sprint")!.id);
  });

  it("leaves the source as it was", () => {
    const s = source();
    const before = JSON.stringify(s);
    copySetup(s, counter());
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("the line under the tiles", () => {
  it("counts what comes over", () => {
    expect(setupLine(summarize(source()))).toBe(
      "From Ushabti roadmap: 8 properties with their options, 3 views, the card, the agent rules, releases on, sprints off. Releases start with no versions. Tasks, people and webhooks stay behind.",
    );
  });

  it("leaves out a part the source does not have", () => {
    const s = source();
    s.project.cardView = null;
    s.project.agentRules = "  ";
    s.project.releaseBy = null;
    s.project.sprintBy = "sprint";
    expect(setupLine(summarize(s))).toBe(
      "From Ushabti roadmap: 8 properties with their options, 3 views, releases off, sprints on. Sprints start with none. Tasks, people and webhooks stay behind.",
    );
  });

  it("says one of each, and no options when none come over", () => {
    const one: SetupSummary = {
      name: "Tiny",
      properties: 1,
      options: 0,
      views: 1,
      card: false,
      agentRules: false,
      releases: false,
      sprints: false,
    };
    expect(setupLine(one)).toBe(
      "From Tiny: 1 property, 1 view, releases off, sprints off. Tasks, people and webhooks stay behind.",
    );
  });

  it("counts the options that come over, not those that stay", () => {
    const s = source();
    s.options = s.options.filter((o) => o.propertyId === "version");
    expect(summarize(s).options).toBe(0);
  });
});
