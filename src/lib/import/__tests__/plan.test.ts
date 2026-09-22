import { describe, expect, it } from "vitest";
import { droppedSaid, planImport, previewOf, type ProjectShape } from "../plan";
import { fixture } from "./fixture";

/**
 * What the file becomes on this board.
 *
 * The plan is the whole of the mapping and it reads no database, so every
 * rule the design settled — a list is an option, a name that matches is
 * reused, a person is matched and never made, nothing twice — is asked here
 * rather than through a browser.
 */

const STATUS = "prop-status";
const LABELS = "prop-labels";
const DUE = "prop-due";
const ASSIGNEE = "prop-assignee";

/** A project of the shape a new one has, with Ada already a member. */
function board(over: Partial<ProjectShape> = {}): ProjectShape {
  return {
    properties: [
      {
        id: STATUS,
        name: "Status",
        type: "select",
        options: [
          { id: "opt-backlog", name: "Backlog" },
          { id: "opt-todo", name: "Todo" },
          { id: "opt-doing", name: "In Progress" },
        ],
      },
      {
        id: LABELS,
        name: "Labels",
        type: "multi_select",
        options: [{ id: "opt-bug", name: "bug" }],
      },
      { id: DUE, name: "Due", type: "date", options: [] },
      { id: ASSIGNEE, name: "Assignee", type: "person", options: [] },
    ],
    members: [{ id: "user-ada", name: "Ada Lovelace" }],
    groupPropertyId: STATUS,
    already: new Set<string>(),
    ...over,
  };
}

describe("planImport", () => {
  it("makes the lists options of the main view's grouping property", () => {
    const plan = planImport(fixture(), board());
    expect(plan.group).toEqual({ id: STATUS, name: "Status", making: false });
    expect(plan.lists.map((l) => l.name)).toEqual(["To do", "in progress", "Done"]);
  });

  it("proposes an option whose name matches, ignoring case", () => {
    const plan = planImport(fixture(), board());
    const doing = plan.lists.find((l) => l.name === "in progress");
    expect(doing).toMatchObject({
      optionId: "opt-doing",
      optionName: "In Progress",
      making: false,
    });
  });

  it("adds an option for a list nothing matches", () => {
    const plan = planImport(fixture(), board());
    const todo = plan.lists.find((l) => l.name === "To do");
    expect(todo).toMatchObject({ optionId: null, making: true, cards: 2 });
  });

  it("lets the owner point a list at an option the board already has", () => {
    const shape = board();
    const plan = planImport(fixture(), shape, {
      lists: { "5f2a1c9e4b3d2a0011ee0001": "opt-todo" },
    });
    const todo = plan.lists.find((l) => l.name === "To do");
    expect(todo).toMatchObject({ optionId: "opt-todo", optionName: "Todo", making: false });
  });

  it("falls back to the proposal when the owner names an option that is gone", () => {
    const plan = planImport(fixture(), board(), {
      lists: { "5f2a1c9e4b3d2a0011ee0002": "opt-that-went" },
    });
    const doing = plan.lists.find((l) => l.name === "in progress");
    expect(doing?.optionId).toBe("opt-doing");
  });

  it("reuses a label of the same name and adds the other", () => {
    const plan = planImport(fixture(), board());
    expect(plan.labels.map((l) => [l.name, l.optionId])).toEqual([
      ["bug", "opt-bug"],
      ["Release", null],
    ]);
  });

  it("writes the cards in list order and leaves the archived ones out", () => {
    const plan = planImport(fixture(), board());
    expect(plan.tasks.map((t) => t.title)).toEqual([
      "Write the launch note",
      "Talk to the team",
      "Fix the sign-in loop",
      "Ship the changelog",
    ]);
    expect(plan.archived).toEqual({ inFile: 1, coming: false });
  });

  it("brings the archived cards in, archived, when the switch is on", () => {
    const plan = planImport(fixture(), board(), { archived: true });
    const old = plan.tasks.find((t) => t.title === "Old idea nobody took");
    expect(old?.archived).toBe(true);
    expect(plan.tasks).toHaveLength(5);
  });

  it("takes the date part of a due moment, in UTC", () => {
    const plan = planImport(fixture(), board());
    const task = plan.tasks.find((t) => t.title === "Ship the changelog");
    expect(task?.due).toBe("2026-03-04");
  });

  it("assigns the first member when somebody here has that name", () => {
    const plan = planImport(fixture(), board());
    const task = plan.tasks.find((t) => t.title === "Write the launch note");
    expect(task?.assigneeId).toBe("user-ada");
    expect(plan.people.matched).toEqual(["Ada Lovelace"]);
  });

  it("puts a name nobody here carries on the last line of the description", () => {
    const plan = planImport(fixture(), board());
    /* Grace is the first of the two members of this card and nobody here is
       called that, so the card carries her name instead of an assignee. */
    const task = plan.tasks.find((t) => t.title === "Fix the sign-in loop");
    expect(task?.assigneeId).toBeNull();
    expect(task?.description).toBe(
      "Two people are stuck on the second screen.\n\nAssigned on Trello to Grace Hopper.",
    );
    expect(plan.people.named).toEqual(["Grace Hopper"]);
  });

  it("keeps the checklist and names the list when a card had two", () => {
    const plan = planImport(fixture(), board());
    const task = plan.tasks.find((t) => t.title === "Ship the changelog");
    expect(task?.checklist).toEqual([
      { text: "Before: Draft it", done: true },
      { text: "Before: Read it back", done: false },
      { text: "After: Post it", done: false },
    ]);
  });

  it("writes a comment as the importer with its author named", () => {
    const plan = planImport(fixture(), board());
    const task = plan.tasks.find((t) => t.title === "Talk to the team");
    expect(task?.comments).toEqual([
      { body: "**Ada Lovelace** wrote on Trello:\n\nI will book the room." },
      { body: "**Grace Hopper** wrote on Trello:\n\nLet us do this after the release." },
    ]);
  });

  it("names the card it came from, so a second run can find it", () => {
    const plan = planImport(fixture(), board());
    expect(plan.tasks[0].sourceId).toBe("5f2a1c9e4b3d2a0011ff0001");
    expect(plan.tasks[0].sourceKey).toBe("bbbb0001");
  });

  it("makes the property it needs when the board has none of that name", () => {
    const plan = planImport(fixture(), board({ properties: [], groupPropertyId: null }));
    expect(plan.group).toEqual({ id: null, name: "Status", making: true });
    expect(plan.labelsProperty.making).toBe(true);
    expect(plan.dueProperty.making).toBe(true);
    expect(plan.assigneeProperty.making).toBe(true);
  });
});

describe("nothing twice", () => {
  it("makes nothing on a second reading of the same file", () => {
    const first = planImport(fixture(), board());
    const already = new Set(first.tasks.map((t) => t.sourceId));
    const second = planImport(fixture(), board({ already }));
    expect(second.tasks).toEqual([]);
    expect(second.already).toBe(4);
  });

  it("brings only the cards it has not taken", () => {
    const already = new Set(["5f2a1c9e4b3d2a0011ff0001"]);
    const plan = planImport(fixture(), board({ already }));
    expect(plan.tasks.map((t) => t.title)).not.toContain("Write the launch note");
    expect(plan.tasks).toHaveLength(3);
    expect(plan.already).toBe(1);
  });

  it("counts a card it already has against the list it came from", () => {
    const already = new Set(["5f2a1c9e4b3d2a0011ff0001"]);
    const plan = planImport(fixture(), board({ already }));
    expect(plan.lists.find((l) => l.name === "To do")?.cards).toBe(1);
  });
});

describe("what does not come", () => {
  it("says every kind the file carries, in numbers", () => {
    const said = droppedSaid(planImport(fixture(), board()));
    expect(said).toContain("1 attachment is left behind.");
    expect(said).toContain("1 custom field is left behind.");
    expect(said).toContain("1 start date is left behind.");
    expect(said).toContain("1 archived list is left behind, with its cards.");
    expect(said).toContain("1 card names a second person; only the first one comes.");
    expect(said.some((line) => line.includes("1 archived card stays behind"))).toBe(true);
  });

  it("stops saying the archived cards stay once the switch is on", () => {
    const said = droppedSaid(planImport(fixture(), board(), { archived: true }));
    expect(said.some((line) => line.includes("stays behind"))).toBe(false);
  });
});

describe("previewOf", () => {
  it("carries counts and never the cards", () => {
    const preview = previewOf(planImport(fixture(), board()));
    expect(preview.tasks).toEqual({ coming: 4, already: 0 });
    expect(preview.board).toBe("Launch board");
    expect(Object.keys(preview)).not.toContain("tasks.list");
    expect(JSON.stringify(preview)).not.toContain("Two people are stuck");
  });

  it("offers a chooser only for the labels a card wears", () => {
    const preview = previewOf(planImport(fixture(), board()));
    expect(preview.labels.every((label) => label.cards > 0)).toBe(true);
  });
});

/**
 * Two lists of one name.
 *
 * A Trello board may hold two lists called Done, and an option is a name on
 * this board: two columns called Done cannot be told apart on a card, in a
 * filter or by the next import. So they become one column, and the preview
 * says so before anybody presses the button.
 */
describe("two lists of one name", () => {
  const twins = {
    ...fixture(),
    lists: [
      { id: "list-a", name: "Done", pos: 1 },
      { id: "list-b", name: "done", pos: 2 },
    ],
    cards: [
      { ...fixture().cards[0], id: "card-a", listId: "list-a" },
      { ...fixture().cards[1], id: "card-b", listId: "list-b" },
    ],
  };

  it("keeps the two rows apart, each naming the list it came from", () => {
    const plan = planImport(twins, board());
    expect(plan.lists.map((l) => [l.sourceId, l.name, l.cards])).toEqual([
      ["list-a", "Done", 1],
      ["list-b", "done", 1],
    ]);
    expect(plan.lists.every((l) => l.making)).toBe(true);
  });

  it("says they become one column", () => {
    expect(droppedSaid(planImport(twins, board()))).toContain(
      "2 lists are called “Done”. They become one column.",
    );
  });

  it("says nothing when the two land on an option the board already has", () => {
    /* Agreeing about an old name is not sharing a new one: both point at the
       board's own option, which the rows already show. */
    const same = {
      ...twins,
      lists: [
        { ...twins.lists[0], name: "Todo" },
        { ...twins.lists[1], name: "todo" },
      ],
    };
    expect(droppedSaid(planImport(same, board())).some((line) => line.includes("one column"))).toBe(
      false,
    );
  });
});
