import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readExport } from "../read";
import { sourceName, SOURCE_NAMES } from "../source";
import { FIXTURE } from "./fixture";

/**
 * Which reader a file goes to. There is no form field for it: the file's own
 * shape decides.
 */

describe("readExport", () => {
  it("reads a Trello export by its lists and cards", () => {
    const read = readExport(readFileSync(FIXTURE, "utf8"));
    if (!read.ok) throw new Error(read.said);
    expect(read.board.source.word).toBe("trello");
    expect(read.board.source.name).toBe("Trello");
    expect(read.board.name).toBe("Launch board");
  });

  it("refuses JSON no reader knows, naming the kinds it takes", () => {
    expect(readExport(JSON.stringify({ hello: "world" }))).toEqual({
      ok: false,
      said: "That file is not an export the import knows. It takes a board exported from Trello or GitHub.",
    });
    /* Half of a Trello board is not one. */
    expect(readExport(JSON.stringify({ lists: [] })).ok).toBe(false);
  });

  it("still says when the file is not JSON at all", () => {
    expect(readExport("not json")).toEqual({
      ok: false,
      said: "That file is not JSON. Export the board again as JSON.",
    });
  });
});

describe("sourceName", () => {
  it("names a stored word from the one map, and nothing it does not know", () => {
    expect(sourceName("trello")).toBe("Trello");
    expect(sourceName("toString")).toBeNull();
    expect(sourceName("somewhere")).toBeNull();
    expect(sourceName(undefined)).toBeNull();
    expect(Object.keys(SOURCE_NAMES)).toContain("trello");
  });
});
