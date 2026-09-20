import { describe, expect, it } from "vitest";
import { foldKey, readFolded, setFolded } from "../fold";

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
