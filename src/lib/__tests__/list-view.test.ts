import { describe, expect, it } from "vitest";
import { cardItems, readCardView } from "../card-view";
import { listColumns, listTemplate, TITLE_MAX_WIDTH, TITLE_MIN_WIDTH } from "../list-view";
import type { PropertyDTO } from "../types";

const STATUS: PropertyDTO = {
  id: "p-status",
  name: "Status",
  type: "select",
  position: "V",
  config: {},
  options: [{ id: "o-todo", name: "Todo", color: "#9aa0aa", position: "V" }],
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

const POINTS: PropertyDTO = {
  id: "p-points",
  name: "Points",
  type: "number",
  position: "u",
  config: {},
  options: [],
};

const PROPERTIES = [STATUS, PRIORITY, ASSIGNEE, POINTS];

/** The columns a saved card view produces, as ids. */
function columnsOf(saved: unknown, groupById: string | null = "p-status") {
  return listColumns(cardItems(readCardView(saved, PROPERTIES, groupById), PROPERTIES));
}

function idsOf(saved: unknown, groupById: string | null = "p-status") {
  return columnsOf(saved, groupById).map((c) => c.id);
}

describe("the columns of a list", () => {
  it("takes them from the card view, so one page arranges both drawings", () => {
    const ids = idsOf(null);
    /* Priority, Assignee and Points are on the card, so they are columns. */
    expect(ids).toContain("p-prio");
    expect(ids).toContain("p-who");
    expect(ids).toContain("p-points");
  });

  it("leaves out a row the card leaves off", () => {
    /* The default card hides the property the board's columns already say. */
    expect(idsOf(null)).not.toContain("p-status");
    /* And it comes back the moment somebody puts it on the card. */
    const put = {
      order: ["_key", "_title", "p-status"],
      rows: { "p-status": { place: "footerL", mode: "text" } },
    };
    expect(idsOf(put)).toContain("p-status");
  });

  it("leaves out the edge, because a stripe is not a column", () => {
    const saved = {
      order: ["_key", "_title", "p-prio"],
      rows: { "p-prio": { place: "edge", mode: "colour" } },
    };
    expect(idsOf(saved)).not.toContain("p-prio");
  });

  it("leaves out the description, because a line has one line", () => {
    const saved = {
      order: ["_key", "_title", "_desc"],
      rows: { _desc: { place: "body", mode: "two" } },
    };
    expect(idsOf(saved)).not.toContain("_desc");
  });

  it("opens with the key and the title, whatever the card view says", () => {
    /* A table is read from the left, and the name of the task is what a
       person looks for. */
    const saved = {
      order: ["p-prio", "p-who", "_title", "_key"],
      rows: {
        "p-prio": { place: "footerL", mode: "both" },
        "p-who": { place: "footerL", mode: "avatar" },
        _key: { place: "headerL", mode: "text" },
      },
    };
    expect(idsOf(saved).slice(0, 2)).toEqual(["_key", "_title"]);
  });

  it("always has a title, even when the card view has lost it", () => {
    const ids = idsOf({ order: ["p-prio"], rows: { "p-prio": { place: "footerL" } } });
    expect(ids).toContain("_title");
  });

  it("keeps the rest in the order the card view puts them", () => {
    const ids = idsOf(null).filter((id) => id.startsWith("p-"));
    const order = readCardView(null, PROPERTIES, "p-status").order.filter((id) => ids.includes(id));
    expect(ids).toEqual(order);
  });

  it("holds the key and the title in place, and nothing else", () => {
    const columns = columnsOf(null);
    const held = columns.filter((c) => c.pin !== null).map((c) => c.id);
    expect(held).toEqual(["_key", "_title"]);
    /* The title stops where the key ends, gap included. */
    expect(columns[0].pin).toBe(0);
    expect(columns[1].pin).toBe(columns[0].width + 8);
  });

  it("reads a number from the right, and nothing else", () => {
    const right = columnsOf(null)
      .filter((c) => c.right)
      .map((c) => c.id);
    expect(right).toEqual(["p-points"]);
  });
});

describe("the grid template", () => {
  it("gives every column its width and the title the room between", () => {
    const columns = columnsOf(null);
    const template = listTemplate(columns);
    expect(template.startsWith(`${columns[0].width}px minmax(`)).toBe(true);
    expect(template).toContain(`minmax(${TITLE_MIN_WIDTH}px, ${TITLE_MAX_WIDTH}px)`);
  });

  it("ends in a track nothing is drawn in, so the slack falls off the end", () => {
    /* Without it the title takes every spare pixel and the properties huddle
       at the far right, which is the one thing a list is for. */
    const template = listTemplate(columnsOf(null));
    expect(template.endsWith(" 1fr")).toBe(true);
    expect(template.split(" ").filter((t) => t === "1fr")).toHaveLength(1);
  });
});
