import { describe, expect, it } from "vitest";
import { readCardView } from "../card-view";
import {
  blockedSaid,
  copiedCardView,
  copiedLooks,
  copyQuestion,
  countLook,
  countSaid,
  matchLook,
  staysSaid,
} from "../look";
import type { CardView, PropertyDTO, PropertyOptionDTO, PropertyType } from "../types";

function option(id: string, name: string, color = "#888888", icon: string | null = null) {
  return {
    id,
    name,
    color,
    icon,
    position: id,
    startAt: null,
    targetAt: null,
    shippedAt: null,
    note: null,
  } satisfies PropertyOptionDTO;
}

function prop(
  id: string,
  name: string,
  type: PropertyType,
  options: PropertyOptionDTO[] = [],
  config: PropertyDTO["config"] = {},
): PropertyDTO {
  return { id, name, type, position: id, config, options };
}

describe("matchLook", () => {
  it("matches a name in another letter case", () => {
    const here = [prop("h1", "Priority", "select")];
    const there = [prop("t1", " priority ", "select")];
    const match = matchLook(here, there);
    expect(match.pairs.map((p) => [p.here.id, p.there.id])).toEqual([["h1", "t1"]]);
    expect(match.unmatched).toEqual([]);
  });

  it("does not match a name of another kind, but matches a type of the same kind", () => {
    const here = [prop("h1", "Estimate", "number"), prop("h2", "Labels", "multi_select")];
    const there = [prop("t1", "Estimate", "select"), prop("t2", "Labels", "select")];
    const match = matchLook(here, there);
    expect(match.unmatched.map((p) => p.id)).toEqual(["h1"]);
    expect(match.pairs.map((p) => [p.here.id, p.there.id])).toEqual([["h2", "t2"]]);
  });

  it("takes the first of two properties of one name, and each one once", () => {
    const here = [prop("h1", "Area", "select"), prop("h2", "Area", "select")];
    const there = [prop("t1", "Area", "select"), prop("t2", "area", "select")];
    const match = matchLook(here, there);
    expect(match.pairs.map((p) => [p.here.id, p.there.id])).toEqual([
      ["h1", "t1"],
      ["h2", "t2"],
    ]);

    const one = matchLook(here, [prop("t1", "Area", "select")]);
    expect(one.pairs.map((p) => p.there.id)).toEqual(["t1"]);
    expect(one.unmatched.map((p) => p.id)).toEqual(["h2"]);
  });

  it("leaves an option with no match alone, and counts only what takes a look", () => {
    const here = [
      prop("h1", "Status", "select", [option("ho1", "Todo"), option("ho2", "Blocked")]),
      prop("h2", "Urgent", "checkbox"),
      prop("h3", "Sprint", "iteration"),
    ];
    const there = [
      prop("t1", "Status", "select", [
        option("to1", "TODO", "#ff0000", "bug"),
        option("to2", "Done"),
      ]),
      prop("t2", "Urgent", "checkbox", [], { icon: "flame", color: "#00ff00" }),
    ];
    const match = matchLook(here, there);
    expect(match.pairs[0].options.map((o) => [o.here.id, o.there.id])).toEqual([["ho1", "to1"]]);

    const count = countLook(match);
    expect(count).toEqual({ matched: 2, total: 3, looks: 2, unmatched: ["Sprint"] });

    expect(copiedLooks(match)).toEqual({
      options: [{ id: "ho1", color: "#ff0000", icon: "bug" }],
      checkboxes: [{ id: "h2", color: "#00ff00", icon: "flame" }],
    });
  });
});

describe("copiedCardView", () => {
  const here = [
    prop("h1", "Status", "select"),
    prop("h2", "Priority", "select"),
    prop("h3", "Sprint", "iteration"),
  ];
  const there = [prop("t1", "Status", "select"), prop("t2", "Priority", "select")];

  it("writes the matched rows and the task's own, and keeps an unmatched row", () => {
    const mine: CardView = readCardView(
      {
        rows: {
          _key: { place: "headerL", mode: "text" },
          h1: { place: "footerL", mode: "both" },
          h3: { place: "body", mode: "fill" },
        },
      },
      here,
      null,
    );
    const theirs = readCardView(
      {
        rows: {
          _key: { place: "off", mode: "boxed" },
          _desc: { place: "body", mode: "one" },
          t1: { place: "headerR", mode: "text" },
          t2: { place: "off", mode: "colour" },
        },
      },
      there,
      null,
    );
    const out = readCardView(copiedCardView(mine, theirs, matchLook(here, there)), here, null);
    expect(out.rows._key).toEqual({ place: "off", mode: "boxed" });
    expect(out.rows._desc).toEqual({ place: "body", mode: "one" });
    expect(out.rows.h1).toEqual({ place: "headerR", mode: "text" });
    expect(out.rows.h2).toEqual({ place: "off", mode: "colour" });
    expect(out.rows.h3).toEqual({ place: "body", mode: "fill" });
  });

  it("moves the edge when the row that holds it there has a match here", () => {
    const mine = readCardView({ rows: { h3: { place: "edge", mode: "colour" } } }, here, null);
    const theirs = readCardView({ rows: { t2: { place: "edge", mode: "colour" } } }, there, null);
    const out = readCardView(copiedCardView(mine, theirs, matchLook(here, there)), here, null);
    expect(out.rows.h2.place).toBe("edge");
    expect(out.rows.h3.place).not.toBe("edge");
    expect(Object.values(out.rows).filter((r) => r.place === "edge")).toHaveLength(1);
  });

  it("keeps the edge here when the other card's edge has no match here", () => {
    const mine = readCardView({ rows: { h3: { place: "edge", mode: "colour" } } }, here, null);
    const far = [...there, prop("t9", "Team", "select")];
    const theirs = readCardView({ rows: { t9: { place: "edge", mode: "colour" } } }, far, null);
    const out = readCardView(copiedCardView(mine, theirs, matchLook(here, far)), here, null);
    expect(out.rows.h3.place).toBe("edge");
  });
});

describe("the words", () => {
  const count = { matched: 6, total: 8, looks: 17, unmatched: ["Sprint", "Estimate"] };
  const both = { layout: true, looks: true };

  it("says a line with the ticked halves only", () => {
    expect(countSaid(count, both)).toBe("6 of 8 properties · 17 icons and colours");
    expect(countSaid(count, { layout: true, looks: false })).toBe("6 of 8 properties");
    expect(countSaid(count, { layout: false, looks: true })).toBe("17 icons and colours");
    expect(staysSaid(count)).toBe("Sprint and Estimate here stay as they are.");
    expect(staysSaid({ ...count, unmatched: ["Release"] })).toBe("Release here stays as it is.");
    expect(staysSaid({ ...count, unmatched: [] })).toBeNull();
  });

  it("asks with real numbers, and only about what is ticked", () => {
    const c = { ...count, looks: 21 };
    expect(copyQuestion("Mnemes cards", c, both)).toBe(
      "Copy the look of Mnemes cards? This project's default card is replaced, and 21 options and checkboxes take its icon and colour. Tasks do not change.",
    );
    expect(copyQuestion("Docs", c, { layout: true, looks: false })).toBe(
      "Copy the look of Docs? This project's default card is replaced. Tasks do not change.",
    );
    expect(copyQuestion("Docs", c, { layout: false, looks: true })).toBe(
      "Copy the look of Docs? 21 options and checkboxes take its icon and colour. Tasks do not change.",
    );
  });

  it("says why the press is off", () => {
    expect(blockedSaid(false, both)).toBe("Pick a project to copy from.");
    expect(blockedSaid(true, { layout: false, looks: false })).toBe("Pick what to copy.");
    expect(blockedSaid(true, both)).toBeNull();
  });
});
