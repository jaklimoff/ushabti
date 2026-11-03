import { describe, expect, it } from "vitest";
import { cardItems, readCardView } from "../card-view";
import {
  cellCap,
  listColumns,
  listTemplate,
  readLensWidths,
  shareOf,
  sortArrow,
  TITLE_MAX_WIDTH,
  TITLE_MIN_SHARE,
  TITLE_MIN_WIDTH,
} from "../list-view";
import type { PropertyDTO } from "../types";

const STATUS: PropertyDTO = {
  id: "p-status",
  name: "Status",
  type: "select",
  position: "V",
  config: {},
  options: [
    {
      id: "o-todo",
      name: "Todo",
      color: "#9aa0aa",
      icon: null,
      position: "V",
      startAt: null,
      targetAt: null,
      shippedAt: null,
      note: null,
    },
  ],
};

const PRIORITY: PropertyDTO = {
  id: "p-prio",
  name: "Priority",
  type: "select",
  position: "k",
  config: {},
  options: [
    {
      id: "o-urgent",
      name: "Urgent",
      color: "#e0574d",
      icon: null,
      position: "V",
      startAt: null,
      targetAt: null,
      shippedAt: null,
      note: null,
    },
  ],
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
      rows: { "p-status": { place: "footerL", mode: "text" } },
    };
    expect(idsOf(put)).toContain("p-status");
  });

  it("leaves out the edge, because a stripe is not a column", () => {
    const saved = {
      rows: { "p-prio": { place: "edge", mode: "colour" } },
    };
    expect(idsOf(saved)).not.toContain("p-prio");
  });

  it("leaves out the description, because a line has one line", () => {
    const saved = {
      rows: { _desc: { place: "body", mode: "two" } },
    };
    expect(idsOf(saved)).not.toContain("_desc");
  });

  it("opens with the key and the title, even under an order an older release saved", () => {
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
    const ids = idsOf({ rows: { "p-prio": { place: "footerL" } } });
    expect(ids).toContain("_title");
  });

  it("keeps the rest in the order of the properties", () => {
    const ids = (properties: PropertyDTO[]) =>
      listColumns(cardItems(readCardView(null, properties, "p-status"), properties))
        .map((c) => c.id)
        .filter((id) => id.startsWith("p-"));
    expect(ids(PROPERTIES)).toEqual(["p-prio", "p-who", "p-points"]);
    /* A drag in Settings moves the column, and the key and the title stay first. */
    expect(ids([...PROPERTIES].reverse())).toEqual(["p-points", "p-who", "p-prio"]);
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
  it("makes the title as wide as the longest one, and the track that gives", () => {
    const columns = columnsOf(null);
    const template = listTemplate(columns);
    expect(template.startsWith(`${columns[0].width}px minmax(`)).toBe(true);
    expect(template).toContain(
      `minmax(min(${TITLE_MIN_WIDTH}px, ${TITLE_MIN_SHARE}), max-content)`,
    );
  });

  it("caps every cell but the key's, the title's at its own ceiling", () => {
    /* The track follows its widest cell, so the ceiling has to be on the cells. */
    const columns = columnsOf(null);
    const byId = (id: string) => columns.find((c) => c.id === id)!;
    expect(cellCap(byId("_key"))).toBeNull();
    expect(cellCap(byId("_title"))).toBe(TITLE_MAX_WIDTH);
    expect(cellCap(byId("p-prio"))).toBe(byId("p-prio").width);
  });

  it("sizes a property to what it holds, never past its width", () => {
    /* A column sized by its type gave "S" the room of "Second Person", and
       the title paid for it. */
    const columns = columnsOf(null);
    const template = listTemplate(columns);
    for (const column of columns.filter((c) => c.pin === null)) {
      expect(template).toContain(`fit-content(${column.width}px)`);
    }
  });

  it("keeps the key fixed, because the title is held just after it", () => {
    const columns = columnsOf(null);
    expect(listTemplate(columns).split(" ")[0]).toBe(`${columns[0].width}px`);
    expect(columns[1].pin).toBe(columns[0].width + 8);
  });

  it("ends in a track nothing is drawn in, so the slack falls off the end", () => {
    /* Without it the title takes every spare pixel and the properties huddle
       at the far right, which is the one thing a list is for. */
    const template = listTemplate(columnsOf(null));
    expect(template.endsWith(" 1fr")).toBe(true);
    expect(template.split(" ").filter((t) => t === "1fr")).toHaveLength(1);
  });
});

describe("the sort arrow", () => {
  const item = (id: string) => columnsOf(null).find((c) => c.id === id)!.item;

  it("points up for the small end first, as the words say", () => {
    expect(sortArrow(item("_title"), "asc")).toBe("up");
    expect(sortArrow(item("_title"), "desc")).toBe("down");
    expect(sortArrow(item("p-points"), "asc")).toBe("up");
  });

  it("points down for a select's own order, top option first", () => {
    /* "Option order" puts Urgent first; "Reverse order" puts Low first. */
    expect(sortArrow(item("p-prio"), "asc")).toBe("down");
    expect(sortArrow(item("p-prio"), "desc")).toBe("up");
  });
});

describe("a Link column", () => {
  it("has a width of its own", () => {
    const prs: PropertyDTO = {
      id: "p-prs",
      name: "Pull requests",
      type: "link",
      position: "z",
      config: {},
      options: [],
    };
    const items = cardItems(
      readCardView({ rows: { "p-prs": { place: "footerL", mode: "text" } } }, [prs], null),
      [prs],
    );
    const column = listColumns(items).find((c) => c.item.id === "p-prs");
    expect(column?.width).toBe(168);
  });
});

describe("the widths a person drags", () => {
  const items = () => cardItems(readCardView(null, PROPERTIES, "p-status"), PROPERTIES);

  it("draws a kept width as its share of the list, never under the floor", () => {
    const columns = listColumns(items(), { "p-prio": 0.25, _title: 0.3 });
    const prio = columns.find((c) => c.id === "p-prio")!;
    const title = columns.find((c) => c.id === "_title")!;
    expect(prio.track).toBe("max(40px, 25%)");
    expect(title.track).toBe("max(120px, 30%)");
    expect(cellCap(prio)).toBe("100%");

    const tracks = listTemplate(columns).split(" ");
    expect(listTemplate(columns)).toContain("max(40px, 25%)");
    expect(tracks.at(-1)).toBe("1fr");
  });

  it("draws pixels while an edge is held, over what is kept", () => {
    const columns = listColumns(items(), { "p-prio": 0.25 }, { "p-prio": 240, "p-who": 130 });
    expect(columns.find((c) => c.id === "p-prio")!.track).toBe("240px");
    expect(columns.find((c) => c.id === "p-who")!.track).toBe("130px");
  });

  it("leaves a column nobody dragged to size itself", () => {
    const columns = listColumns(items(), { "p-prio": 0.25 });
    const who = columns.find((c) => c.id === "p-who")!;
    expect(who.track).toBeNull();
    expect(listTemplate(columns)).toContain(`fit-content(${who.width}px)`);
  });

  it("never sizes the key, because the title is held just after it", () => {
    const columns = listColumns(items(), { _key: 0.3 }, { _key: 300 });
    expect(columns[0].id).toBe("_key");
    expect(columns[0].track).toBeNull();
    expect(columns[1].pin).toBe(columns[0].width + 8);
  });

  it("keeps a width as a share, to four places", () => {
    expect(shareOf(250, 1000)).toBe(0.25);
    expect(shareOf(333, 1000)).toBe(0.333);
    expect(shareOf(1, 3)).toBe(0.3333);
    expect(shareOf(2000, 1000)).toBe(1);
  });

  it("reads afresh: a gone column, the key and anything that is no share are dropped", () => {
    const read = readLensWidths(
      {
        rules: [],
        widths: {
          "p-prio": 0.2,
          "p-gone": 0.2,
          _key: 0.3,
          _desc: 0.3,
          _comments: "wide",
          _checklist: Number.NaN,
          "p-who": 240,
          "p-points": 0,
          _title: 0.4,
        },
      },
      PROPERTIES,
    );
    expect(read).toEqual({ "p-prio": 0.2, _title: 0.4 });
  });

  it("reads nothing out of a lens that holds none", () => {
    expect(readLensWidths(null, PROPERTIES)).toEqual({});
    expect(readLensWidths({ rules: [] }, PROPERTIES)).toEqual({});
    expect(readLensWidths({ widths: [1, 2] }, PROPERTIES)).toEqual({});
  });
});
