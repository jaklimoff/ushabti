import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  foldKey,
  foldedOf,
  noFolds,
  readFolded,
  readStartFolded,
  setFolded,
  writeFolded,
} from "../fold";
import type { PropertyDTO } from "../types";

describe("where a fold is kept", () => {
  it("names the view, because a column id means nothing outside one", () => {
    expect(foldKey("v-1")).toBe("ushabti:folded:v-1");
    expect(foldKey("v-1")).not.toBe(foldKey("v-2"));
  });
});

describe("reading what a browser wrote", () => {
  it("answers the folded columns", () => {
    expect(readFolded('["o-shipped","o-done"]')).toEqual(["o-shipped", "o-done"]);
  });

  it("answers nothing when nothing was written", () => {
    expect(readFolded(null)).toEqual([]);
    expect(readFolded("")).toEqual([]);
  });

  /*
   * What is stored belongs to the person, so it can be hand edited, half
   * written or left by an older version. None of that may take the board down.
   */
  it("throws away anything that is not a list of words", () => {
    expect(readFolded("{")).toEqual([]);
    expect(readFolded('"o-shipped"')).toEqual([]);
    expect(readFolded("{}")).toEqual([]);
    expect(readFolded('["o-shipped",7,null,""]')).toEqual(["o-shipped"]);
  });
});

describe("folding and opening", () => {
  it("folds a column", () => {
    expect(setFolded([], "o-shipped", true)).toEqual(["o-shipped"]);
  });

  it("opens a column", () => {
    expect(setFolded(["o-shipped", "o-done"], "o-shipped", false)).toEqual(["o-done"]);
  });

  it("names a folded column once", () => {
    expect(setFolded(["o-shipped"], "o-shipped", true)).toEqual(["o-shipped"]);
  });

  it("says nothing about a column that is already open", () => {
    expect(setFolded(["o-done"], "o-shipped", false)).toEqual(["o-done"]);
  });
});

const status = {
  id: "p-status",
  name: "Status",
  type: "select",
  position: "a",
  config: {},
  options: ["o-later", "o-todo", "o-done"].map((id, i) => ({
    id,
    name: id,
    color: "#000",
    position: String(i),
    startAt: null,
    targetAt: null,
    shippedAt: null,
    note: null,
  })),
} as PropertyDTO;
const assignee = { ...status, id: "p-who", type: "person", options: [] } as PropertyDTO;

describe("the columns a view starts with folded", () => {
  it("answers the options of the grouping property, in their order", () => {
    expect(readStartFolded(["o-done", "o-later"], "p-status", [status])).toEqual([
      "o-later",
      "o-done",
    ]);
  });

  it("drops an option that was deleted", () => {
    expect(readStartFolded(["o-gone", "o-later"], "p-status", [status])).toEqual(["o-later"]);
  });

  it("drops what belongs to another property since the grouping changed", () => {
    expect(readStartFolded(["o-later"], "p-who", [status, assignee])).toEqual([]);
    expect(readStartFolded(["o-later"], "p-gone", [status])).toEqual([]);
    expect(readStartFolded(["o-later"], null, [status])).toEqual([]);
  });

  it("reads anything that is not a list as nothing", () => {
    expect(readStartFolded("o-later", "p-status", [status])).toEqual([]);
    expect(readStartFolded(undefined, "p-status", [status])).toEqual([]);
  });
});

describe("whose fold a board draws", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const start = ["o-later"];

  it("draws the view's starting fold for a browser that never folded there", () => {
    expect(foldedOf("v-1", start)).toBe(start);
    expect(noFolds(start)).toBe(start);
  });

  it("draws the person's own folds once they wrote any, even none", () => {
    writeFolded("v-1", ["o-todo"]);
    expect(foldedOf("v-1", start)).toEqual(["o-todo"]);
    writeFolded("v-1", []);
    expect(foldedOf("v-1", start)).toEqual([]);
  });
});
