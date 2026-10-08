import { describe, expect, it } from "vitest";
import { joinLog } from "../run-log";

const line = (id: string) => ({ id, text: id, createdAt: "2026-10-08T10:00:00.000Z" });
const ids = (lines: { id: string }[]) => lines.map((l) => l.id);

describe("a fresh tail joined to the lines the panel holds", () => {
  it("keeps the lines that fell out of the tail and adds the new ones once", () => {
    const held = ["a", "b", "c", "d"].map(line);
    const tail = ["c", "d", "e"].map(line);
    const joined = joinLog(held, tail);
    expect(ids(joined.lines)).toEqual(["a", "b", "c", "d", "e"]);
    expect(joined.gapBefore).toBeNull();
  });

  it("names where the gap starts when the tail jumped past everything held", () => {
    const joined = joinLog(["a", "b"].map(line), ["x", "y"].map(line));
    expect(ids(joined.lines)).toEqual(["a", "b", "x", "y"]);
    expect(joined.gapBefore).toBe("x");
  });

  it("sees no gap in an empty tail or with nothing held", () => {
    expect(joinLog(["a"].map(line), []).gapBefore).toBeNull();
    expect(joinLog([], ["a"].map(line)).gapBefore).toBeNull();
  });
});
