import { describe, expect, it } from "vitest";
import {
  buildCard,
  cardAccent,
  cardItems,
  defaultCardView,
  moveCardRow,
  previewTasks,
  readCardView,
  setCardMode,
  setCardPlace,
  viewOf,
} from "../card-view";
import type { MemberDTO, PropertyDTO, TaskDTO } from "../types";

const STATUS: PropertyDTO = {
  id: "p-status",
  name: "Status",
  type: "select",
  position: "V",
  config: {},
  options: [
    { id: "o-todo", name: "Todo", color: "#9aa0aa", position: "V" },
    { id: "o-done", name: "Done", color: "#4f8a5b", position: "k" },
  ],
};

const PRIORITY: PropertyDTO = {
  id: "p-prio",
  name: "Priority",
  type: "select",
  position: "k",
  config: {},
  options: [{ id: "o-urgent", name: "Urgent", color: "#e0574d", position: "V" }],
};

const ASSIGNEE: PropertyDTO = {
  id: "p-who",
  name: "Assignee",
  type: "person",
  position: "s",
  config: {},
  options: [],
};

const DUE: PropertyDTO = {
  id: "p-due",
  name: "Due",
  type: "date",
  position: "u",
  config: {},
  options: [],
};

const PROPERTIES = [STATUS, PRIORITY, ASSIGNEE, DUE];

const ADA: MemberDTO = {
  id: "m-ada",
  name: "Ada Lovelace",
  email: "ada@example.com",
  color: "#6d5bd0",
  role: "owner",
  kind: "human",
};

function task(values: TaskDTO["values"] = {}, over: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id: "t1",
    number: 1,
    key: "USH-1",
    title: "Something to do",
    description: "The long version of it.",
    position: "V",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    values,
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    ...over,
  };
}

/** The whole card, resolved and joined to its properties. */
function items(saved: unknown, groupById: string | null = "p-status") {
  return cardItems(readCardView(saved, PROPERTIES, groupById), PROPERTIES);
}

function placeOf(saved: unknown, id: string, groupById: string | null = "p-status") {
  return items(saved, groupById).find((i) => i.id === id)?.place;
}

describe("the default card", () => {
  it("draws the card the board drew before this page existed", () => {
    const view = defaultCardView(PROPERTIES, "p-status");
    /* The columns already say the status, so the card never did. */
    expect(view.rows["p-status"].place).toBe("off");
    /* The first select that is not the columns leads with its colour. */
    expect(view.rows["p-prio"]).toEqual({ place: "headerL", mode: "colour" });
    expect(view.rows["p-who"]).toEqual({ place: "headerR", mode: "avatar" });
    expect(view.rows["p-due"].place).toBe("footerL");
    expect(view.rows._title).toEqual({ place: "title", mode: "fixed" });
    expect(view.rows._desc.place).toBe("off");
  });

  it("puts the lead colour before the key, so the square opens the row", () => {
    const view = defaultCardView(PROPERTIES, "p-status");
    expect(view.order.indexOf("p-prio")).toBeLessThan(view.order.indexOf("_key"));
  });

  it("keeps a property that an older project took off the card off it", () => {
    const hidden = { ...DUE, config: { showOnCard: false } };
    const view = defaultCardView([STATUS, PRIORITY, hidden], "p-status");
    expect(view.rows["p-due"].place).toBe("off");
  });
});

describe("reading a saved card view", () => {
  it("throws away a row that names a property nobody can see any more", () => {
    const saved = {
      order: ["p-gone", "_key", "_title"],
      rows: {
        "p-gone": { place: "edge", mode: "colour" },
        _key: { place: "footerR", mode: "text" },
      },
    };
    const view = readCardView(saved, PROPERTIES, "p-status");
    expect(view.order).not.toContain("p-gone");
    expect(view.rows["p-gone"]).toBeUndefined();
    /* And what the row was holding is free again. */
    expect(view.order.filter((id) => view.rows[id].place === "edge")).toHaveLength(0);
  });

  it("gives a property nobody has placed the home its kind belongs to", () => {
    const saved = { order: ["_title"], rows: { _title: { place: "title", mode: "fixed" } } };
    expect(placeOf(saved, "p-who")).toBe("headerR");
    expect(placeOf(saved, "p-due")).toBe("footerL");
  });

  it("never lets the title move or come off", () => {
    const saved = { order: ["_title"], rows: { _title: { place: "off", mode: "text" } } };
    const title = items(saved).find((i) => i.id === "_title");
    expect(title).toMatchObject({ place: "title", mode: "fixed", fixed: true });
  });

  it("hands the edge to one row only", () => {
    const saved = {
      order: ["p-prio", "p-who"],
      rows: {
        "p-prio": { place: "edge", mode: "colour" },
        "p-who": { place: "edge", mode: "avatar" },
      },
    };
    const view = readCardView(saved, PROPERTIES, "p-status");
    expect(view.rows["p-prio"].place).toBe("edge");
    expect(view.rows["p-who"].place).not.toBe("edge");
  });

  it("keeps the edge off a row with no colours of its own", () => {
    const saved = { order: ["p-due"], rows: { "p-due": { place: "edge", mode: "text" } } };
    expect(placeOf(saved, "p-due")).toBe("footerL");
  });

  it("swaps a mode the row cannot read for one it can", () => {
    const saved = { order: ["p-due"], rows: { "p-due": { place: "footerR", mode: "avatar" } } };
    const due = items(saved).find((i) => i.id === "p-due");
    expect(due).toMatchObject({ place: "footerR", mode: "text" });
  });

  it("falls back to the default when the saved value is not a card view", () => {
    expect(readCardView(null, PROPERTIES, "p-status")).toEqual(
      defaultCardView(PROPERTIES, "p-status"),
    );
    expect(readCardView({ order: "no" }, PROPERTIES, null).order).toContain("_title");
  });
});

describe("clicking a row", () => {
  const view = defaultCardView(PROPERTIES, "p-status");

  it("takes the edge off whoever had it", () => {
    const first = setCardPlace(view, "p-prio", "edge");
    const second = setCardPlace(first, "p-who", "edge");
    expect(second.rows["p-prio"].place).toBe("off");
    expect(second.rows["p-who"].place).toBe("edge");
  });

  it("moves a row off the edge when it is asked for words", () => {
    const edged = readCardView(setCardPlace(view, "p-prio", "edge"), PROPERTIES, "p-status");
    expect(edged.rows["p-prio"].mode).toBe("colour");
    const worded = setCardMode(edged, "p-prio", "both");
    expect(worded.rows["p-prio"]).toEqual({ place: "headerL", mode: "both" });
  });

  it("moves a row one place up the list and no further", () => {
    const at = view.order.indexOf("p-due");
    expect(moveCardRow(view, "p-due", -1).order.indexOf("p-due")).toBe(at - 1);
    expect(moveCardRow(view, view.order[0], -1)).toEqual(view);
  });

  it("survives a round trip through the rows on screen", () => {
    expect(viewOf(cardItems(view, PROPERTIES)).rows).toEqual(view.rows);
  });
});

describe("drawing a card", () => {
  const saved = {
    order: ["p-prio", "_key", "_title", "_desc", "p-who", "p-due", "_checklist", "_comments"],
    rows: {
      "p-prio": { place: "edge", mode: "colour" },
      _key: { place: "headerL", mode: "text" },
      _title: { place: "title", mode: "fixed" },
      _desc: { place: "body", mode: "one" },
      "p-who": { place: "headerR", mode: "avatar" },
      "p-due": { place: "footerL", mode: "boxed" },
      _checklist: { place: "footerR", mode: "bar" },
      _comments: { place: "footerR", mode: "text" },
    },
  };

  const resolved = items(saved);

  it("puts every part where the row says", () => {
    const card = buildCard(
      resolved,
      task(
        { "p-prio": "o-urgent", "p-who": "m-ada", "p-due": "2026-08-29" },
        { checklistTotal: 4, checklistDone: 1, commentCount: 2 },
      ),
      [ADA],
    );

    expect(card.edge).toBe("#e0574d");
    expect(card.headerL.map((c) => c.text)).toEqual(["USH-1"]);
    expect(card.headerR[0].person?.name).toBe("Ada Lovelace");
    expect(card.body).toEqual({ text: "The long version of it.", lines: 1 });
    expect(card.footerL[0]).toMatchObject({ text: "Aug 29", boxed: true });
    expect(card.footerR[0].bar).toEqual({ done: 1, total: 4 });
    expect(card.footerR[1]).toMatchObject({ text: "2", bubble: true });
  });

  it("draws only what the task holds", () => {
    const card = buildCard(resolved, task(), [ADA]);
    expect(card.edge).toBeNull();
    expect(card.headerR).toHaveLength(0);
    expect(card.footerL).toHaveLength(0);
    /* No checklist and no comments, so the footer is not there at all. */
    expect(card.footerR).toHaveLength(0);
  });

  it("gives a multi-select one part per value", () => {
    const labels: PropertyDTO = {
      id: "p-labels",
      name: "Labels",
      type: "multi_select",
      position: "z",
      config: {},
      options: [
        { id: "l-bug", name: "bug", color: "#e0574d", position: "V" },
        { id: "l-ux", name: "ux", color: "#c2557a", position: "k" },
      ],
    };
    const list = cardItems(
      readCardView(
        { order: ["p-labels"], rows: { "p-labels": { place: "footerL", mode: "both" } } },
        [labels],
        null,
      ),
      [labels],
    );
    const card = buildCard(list, task({ "p-labels": ["l-bug", "l-ux"] }), []);
    expect(card.footerL.map((c) => c.text)).toEqual(["bug", "ux"]);
  });

  it("shows a checkbox by its name, and only when it is on", () => {
    const done: PropertyDTO = {
      id: "p-done",
      name: "Blocked",
      type: "checkbox",
      position: "z",
      config: {},
      options: [],
    };
    const list = cardItems(readCardView(null, [done], null), [done]);
    expect(buildCard(list, task({ "p-done": true }), []).footerL[0].text).toBe("Blocked");
    expect(buildCard(list, task({ "p-done": false }), []).footerL).toHaveLength(0);
  });
});

describe("the preview", () => {
  it("draws a stand-in only while the project has no tasks", () => {
    const made = previewTasks([], PROPERTIES, [ADA], "USH");
    expect(made).toHaveLength(1);
    expect(made[0].values["p-status"]).toBe("o-todo");

    const real = [task({ "p-prio": "o-urgent" }, { id: "a" }), task({}, { id: "b" })];
    expect(previewTasks(real, PROPERTIES, [ADA], "USH").map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("the colour a panel takes from a card", () => {
  const edged = items({
    order: ["p-status", "p-prio", "_key", "_title", "p-who"],
    rows: {
      "p-status": { place: "edge", mode: "colour" },
      "p-prio": { place: "headerL", mode: "colour" },
      _key: { place: "headerL", mode: "text" },
      _title: { place: "title", mode: "fixed" },
      "p-who": { place: "headerR", mode: "avatar" },
    },
  });

  it("is the stripe the card draws, whatever else has a colour", () => {
    expect(cardAccent(edged, task({ "p-status": "o-done", "p-prio": "o-urgent" }), [])).toBe(
      "#4f8a5b",
    );
  });

  it("is nothing when the task holds no value for the stripe", () => {
    expect(cardAccent(edged, task({ "p-prio": "o-urgent" }), [])).toBeNull();
  });

  it("falls back to the first colour on a card with no stripe", () => {
    const plain = items(null);
    expect(cardAccent(plain, task({ "p-prio": "o-urgent", "p-who": "m-ada" }), [ADA])).toBe(
      "#e0574d",
    );
    expect(cardAccent(plain, task({ "p-who": "m-ada" }), [ADA])).toBe("#6d5bd0");
    expect(cardAccent(plain, task(), [ADA])).toBeNull();
  });

  it("takes no colour from a row that reads as words", () => {
    const words = items({
      order: ["p-prio", "_title"],
      rows: {
        "p-prio": { place: "headerL", mode: "text" },
        _title: { place: "title", mode: "fixed" },
      },
    });
    expect(cardAccent(words, task({ "p-prio": "o-urgent" }), [])).toBeNull();
  });
});
