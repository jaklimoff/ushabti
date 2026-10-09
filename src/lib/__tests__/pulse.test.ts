import { describe, expect, it } from "vitest";
import {
  agentsAtWork,
  agentsLine,
  daysSaid,
  headingOf,
  isQuiet,
  mainColumns,
  splitFolded,
  type LastChange,
} from "../pulse";
import type {
  AgentRunDTO,
  BoardData,
  PropertyDTO,
  PropertyOptionDTO,
  RunStatus,
  TaskDTO,
  ViewDTO,
} from "../types";

const EMPTY = { rules: [] };

function option(id: string, name: string, color: string, position: string): PropertyOptionDTO {
  return { id, name, color, position, startAt: null, targetAt: null, shippedAt: null, note: null };
}

/* Phase, not Status: the card counts whatever the main view groups by. */
const phase: PropertyDTO = {
  id: "p-phase",
  name: "Phase",
  type: "select",
  position: "V",
  config: {},
  options: [
    option("o-idea", "Idea", "#111111", "a"),
    option("o-build", "Build", "#222222", "b"),
    option("o-shipped", "Shipped", "#333333", "c"),
  ],
};

const owner: PropertyDTO = {
  id: "p-owner",
  name: "Owner",
  type: "person",
  position: "W",
  config: {},
  options: [],
};

function task(number: number, values: TaskDTO["values"]): TaskDTO {
  return {
    id: `t-${number}`,
    number,
    key: `PU-${number}`,
    title: `Task ${number}`,
    description: "",
    position: String(number).padStart(3, "0"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    values,
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    blockedBy: [],
    parts: null,
  };
}

function view(over: Partial<ViewDTO>): ViewDTO {
  return {
    id: "v-main",
    name: "Board",
    kind: "board",
    groupById: phase.id,
    position: "a",
    isDefault: true,
    filters: EMPTY,
    lens: EMPTY,
    sort: null,
    lensSort: null,
    cardView: null,
    ...over,
  };
}

function board(views: ViewDTO[], tasks: TaskDTO[]): Parameters<typeof mainColumns>[0] {
  return {
    project: { timeZone: "UTC" } as BoardData["project"],
    today: "2026-10-09",
    members: [
      {
        id: "u-me",
        name: "Me",
        email: "me@example.com",
        color: "#aaaaaa",
        emoji: null,
        role: "owner",
        kind: "human",
        listeningAt: null,
      },
    ],
    former: [],
    properties: [phase, owner],
    views,
    tasks,
    runs: [],
  };
}

/* The board's loader hands in live tasks only: archived and deleted rows never
   reach it, so they cannot reach a count either. */
const tasks = [
  task(1, { [phase.id]: "o-idea" }),
  task(2, { [phase.id]: "o-build", [owner.id]: "u-me" }),
  task(3, { [phase.id]: "o-build" }),
  task(4, { [phase.id]: "o-shipped", [owner.id]: "u-me" }),
  task(5, {}),
];

describe("mainColumns", () => {
  it("counts each column of the main view, in the option order, with its colour", () => {
    expect(mainColumns(board([view({})], tasks), "u-me")).toEqual([
      { id: "o-idea", name: "Idea", color: "#111111", count: 1 },
      { id: "o-build", name: "Build", color: "#222222", count: 2 },
      { id: "o-shipped", name: "Shipped", color: "#333333", count: 1 },
      { id: "__none__", name: "No phase", color: "#3f4650", count: 1 },
    ]);
  });

  it("reads the main view and not the first one", () => {
    const other = view({ id: "v-other", isDefault: false, groupById: owner.id, position: "0" });
    const counts = mainColumns(board([other, view({})], tasks), "u-me");
    expect(counts?.map((c) => c.name)).toEqual(["Idea", "Build", "Shipped", "No phase"]);
  });

  it("counts what the view's filters and this person's lens leave", () => {
    const main = view({
      filters: { rules: [{ propertyId: phase.id, op: "is_not", values: ["o-idea"] }] },
      lens: { rules: [{ propertyId: owner.id, op: "is", values: ["__me__"] }] },
    });
    /* The view's rule on the grouping property takes its column, as on the board. */
    expect(mainColumns(board([main], tasks), "u-me")).toEqual([
      { id: "o-build", name: "Build", color: "#222222", count: 1 },
      { id: "o-shipped", name: "Shipped", color: "#333333", count: 1 },
    ]);
  });

  it("draws nothing for a main view that is a list, a roadmap, or groups by nothing", () => {
    expect(mainColumns(board([view({ kind: "list" })], tasks), "u-me")).toBeNull();
    expect(mainColumns(board([view({ kind: "roadmap" })], tasks), "u-me")).toBeNull();
    expect(mainColumns(board([view({ groupById: null })], tasks), "u-me")).toBeNull();
    expect(mainColumns(board([view({ groupById: "p-gone" })], tasks), "u-me")).toBeNull();
    expect(mainColumns(board([], tasks), "u-me")).toBeNull();
  });
});

describe("splitFolded", () => {
  it("puts a folded column aside and keeps the rest in order", () => {
    const columns = mainColumns(board([view({})], tasks), "u-me") ?? [];
    const { open, aside } = splitFolded(columns, ["o-shipped"]);
    expect(open.map((c) => c.name)).toEqual(["Idea", "Build", "No phase"]);
    expect(aside).toEqual([{ id: "o-shipped", name: "Shipped", color: "#333333", count: 1 }]);
  });
});

function run(agent: string, status: RunStatus, minutesAgo: number): AgentRunDTO {
  const at = new Date(Date.parse("2026-10-09T12:00:00Z") - minutesAgo * 60_000).toISOString();
  return {
    id: `r-${agent}-${status}-${minutesAgo}`,
    taskId: "t-1",
    status,
    goal: "",
    step: "",
    control: null,
    startedAt: at,
    updatedAt: at,
    beatAt: at,
    reportDueAt: null,
    endedAt: null,
    agent: { id: agent, name: agent, color: "#123456", emoji: null },
    stepsTotal: 0,
    stepsDone: 0,
    lastLog: null,
  };
}

describe("agentsAtWork", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");

  it("counts each working agent once and leaves the waiting runs out", () => {
    const runs = [
      run("a", "running", 1),
      run("a", "running", 60),
      run("b", "running", 60),
      run("c", "waiting", 600),
      run("d", "handed_over", 600),
    ];
    /* a has one run that reports, so a is there; b has said nothing for an hour. */
    expect(agentsAtWork(runs, now)).toEqual({ names: ["a"], silent: 1 });
  });

  it("names who works, and says nothing when nobody does", () => {
    expect(agentsLine({ names: ["Builder"], silent: 0 })).toBe("Builder working");
    expect(agentsLine({ names: ["Builder", "Scout"], silent: 0 })).toBe(
      "Builder and Scout working",
    );
    expect(agentsLine({ names: ["Builder", "Scout", "Fixer"], silent: 1 })).toBe(
      "Builder and 2 more working",
    );
    expect(agentsLine({ names: [], silent: 2 })).toBeNull();
  });
});

describe("isQuiet", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const at = (days: number) => ({
    at: new Date(now - days * 24 * 60 * 60 * 1000).toISOString(),
    who: null,
    taskKey: null,
    taskTitle: null,
    kind: "title",
    propertyId: null,
    value: null,
  });

  it("reads a project quiet after three weeks without a change", () => {
    expect(isQuiet(at(22), now)).toBe(true);
    expect(isQuiet(at(20), now)).toBe(false);
    expect(isQuiet(null, now)).toBe(false);
  });
});

function dated(
  id: string,
  name: string,
  startAt: string | null,
  targetAt: string | null,
): PropertyOptionDTO {
  return { ...option(id, name, "#444444", id), startAt, targetAt };
}

const release: PropertyDTO = {
  id: "p-release",
  name: "Release",
  type: "select",
  position: "X",
  config: { dated: true },
  options: [
    dated("o-022", "0.22", "2026-09-01", "2026-09-30"),
    dated("o-023", "0.23", "2026-10-01", "2026-10-14"),
  ],
};

const sprint: PropertyDTO = {
  id: "p-sprint",
  name: "Sprint",
  type: "iteration",
  position: "Y",
  config: {},
  options: [dated("o-s14", "14", "2026-10-05", "2026-10-12")],
};

function project(over: Partial<BoardData["project"]>): BoardData["project"] {
  return {
    timeZone: "UTC",
    doneWhen: { propertyId: phase.id, optionIds: ["o-shipped"] },
    progressBy: null,
    releaseBy: null,
    sprintBy: null,
    ...over,
  } as BoardData["project"];
}

const work = [
  task(1, { [release.id]: "o-023", [sprint.id]: "o-s14", [phase.id]: "o-shipped" }),
  task(2, { [release.id]: "o-023", [sprint.id]: "o-s14", [phase.id]: "o-build" }),
  task(3, { [release.id]: "o-023", [phase.id]: "o-shipped" }),
  task(4, { [release.id]: "o-022", [phase.id]: "o-build" }),
];

function headed(over: Partial<BoardData["project"]>, last: LastChange | null = null) {
  return headingOf(
    {
      project: project(over),
      today: "2026-10-09",
      properties: [phase, owner, release, sprint],
      views: [view({})],
      tasks: work,
    },
    last,
  );
}

function change(over: Partial<LastChange>): LastChange {
  return {
    at: "2026-10-09T10:00:00.000Z",
    who: "Jack",
    taskKey: "MC-120",
    taskTitle: "Cards table keeps the side pane open",
    kind: "value",
    propertyId: phase.id,
    value: "Build",
    ...over,
  };
}

describe("headingOf", () => {
  it("reads the current release, its day and its tasks over against all of them", () => {
    expect(headed({ releaseBy: release.id, sprintBy: sprint.id }, change({}))).toEqual({
      kind: "release",
      property: "Release",
      name: "0.23",
      day: "2026-10-14",
      left: 5,
      done: 2,
      total: 3,
    });
  });

  it("counts by the project's number property, as the column header does", () => {
    const points: PropertyDTO = { ...owner, id: "p-points", type: "number" };
    const heading = headingOf(
      {
        project: project({ releaseBy: release.id, progressBy: points.id }),
        today: "2026-10-09",
        properties: [phase, release, points],
        views: [view({})],
        tasks: [
          task(1, { [release.id]: "o-023", [phase.id]: "o-shipped", [points.id]: 3 }),
          task(2, { [release.id]: "o-023", [points.id]: 5 }),
        ],
      },
      null,
    );
    expect(heading).toMatchObject({ done: 3, total: 8 });
  });

  it("reads the current sprint when releases are off", () => {
    expect(headed({ sprintBy: sprint.id }, change({}))).toEqual({
      kind: "sprint",
      property: "Sprint",
      name: "14",
      day: "2026-10-12",
      left: 3,
      done: 1,
      total: 2,
    });
  });

  it("asks the pointer and never a name: a select named Release with releases off is a select", () => {
    expect(headed({}, change({}))?.kind).toBe("change");
  });

  it("falls through to the change when no release is current", () => {
    const later = { ...release, options: [dated("o-1", "1.0", "2026-11-01", "2026-11-30")] };
    const heading = headingOf(
      {
        project: project({ releaseBy: later.id }),
        today: "2026-10-09",
        properties: [phase, later],
        views: [view({})],
        tasks: work,
      },
      change({}),
    );
    expect(heading?.kind).toBe("change");
  });

  it("says a value change of the main view's grouping property moved the task there", () => {
    expect(headed({}, change({}))).toEqual({
      kind: "change",
      who: "Jack",
      verb: "moved",
      taskKey: "MC-120",
      taskTitle: "Cards table keeps the side pane open",
      to: "Build",
    });
  });

  it("says any other value change changed the task, with no column", () => {
    expect(headed({}, change({ propertyId: owner.id, value: "Me" }))).toMatchObject({
      verb: "changed",
      to: null,
    });
  });

  it("reads a value change as a move only on a main view that is a board", () => {
    const heading = headingOf(
      {
        project: project({}),
        today: "2026-10-09",
        properties: [phase],
        views: [view({ kind: "list" })],
        tasks: [],
      },
      change({}),
    );
    expect(heading).toMatchObject({ verb: "changed", to: null });
  });

  it("names no column when the task was moved out of every one", () => {
    expect(headed({}, change({ value: "empty" }))).toMatchObject({ verb: "moved", to: null });
  });

  it.each([
    ["comment", "commented on"],
    ["created", "created"],
    ["title", "changed"],
    ["description", "changed"],
    ["checklist", "changed"],
    ["archive", "changed"],
    ["link", "changed"],
    ["run", "changed"],
    ["deleted", "changed"],
  ])("says a %s line as %s", (kind, verb) => {
    expect(headed({}, change({ kind, propertyId: null, value: null }))).toMatchObject({
      verb,
      to: null,
    });
  });

  it("names somebody when the actor is gone", () => {
    expect(headed({}, change({ who: null }))).toMatchObject({ who: "Somebody" });
  });

  it("leaves the row empty on a project with no activity", () => {
    expect(headed({}, null)).toBeNull();
  });
});

describe("daysSaid", () => {
  it("counts the days a sprint has, and the days it ran over", () => {
    expect([3, 1, 0, -1, -4].map(daysSaid)).toEqual([
      "3 days left",
      "1 day left",
      "last day",
      "1 day over",
      "4 days over",
    ]);
  });
});
