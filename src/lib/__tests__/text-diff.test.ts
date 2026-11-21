import { describe, expect, it } from "vitest";
import {
  countRows,
  countSaid,
  diffLines,
  foldRows,
  foldSaid,
  linesOf,
  wordMarks,
  type DiffRow,
} from "../text-diff";

const kinds = (rows: DiffRow[]) => rows.map((r) => `${r.kind[0]} ${r.text}`);

describe("diffLines", () => {
  it("reads two equal texts as all the same", () => {
    expect(kinds(diffLines("a\nb", "a\nb"))).toEqual(["s a", "s b"]);
  });

  it("reads an empty text as no lines", () => {
    expect(linesOf("")).toEqual([]);
    expect(kinds(diffLines("", "one\ntwo"))).toEqual(["a one", "a two"]);
    expect(kinds(diffLines("one", ""))).toEqual(["g one"]);
    expect(diffLines("", "")).toEqual([]);
  });

  it("puts the lines taken away before the lines added in one hunk", () => {
    const rows = diffLines(
      "## Goal\nFix it somehow.\n## Context",
      "## Goal\nRetry five times.\n## Context",
    );
    expect(kinds(rows)).toEqual([
      "s ## Goal",
      "g Fix it somehow.",
      "a Retry five times.",
      "s ## Context",
    ]);
  });

  it("finds the shortest change in the middle of a long text", () => {
    const before = ["a", "b", "c", "d", "e", "f"].join("\n");
    const after = ["a", "x", "c", "d", "y", "e", "f"].join("\n");
    expect(kinds(diffLines(before, after))).toEqual([
      "s a",
      "g b",
      "a x",
      "s c",
      "s d",
      "a y",
      "s e",
      "s f",
    ]);
  });

  it("marks the words that changed inside a line that changed in part", () => {
    const rows = diffLines("The sync module.", "The sync module and the mobile app.");
    expect(rows[0]).toEqual({
      kind: "gone",
      text: "The sync module.",
      pieces: [{ text: "The sync module.", marked: false }],
    });
    expect(rows[1]).toEqual({
      kind: "added",
      text: "The sync module and the mobile app.",
      pieces: [
        { text: "The sync module", marked: false },
        { text: " and the mobile app", marked: true },
        { text: ".", marked: false },
      ],
    });
  });

  it("marks nothing in a line rewritten whole", () => {
    const rows = diffLines("Fix the offline queue somehow.", "A failed send retries five times.");
    expect(rows.map((r) => (r.kind === "same" ? null : r.pieces))).toEqual([null, null]);
  });

  it("marks nothing on a line with no partner", () => {
    const rows = diffLines("a", "a\nnew line");
    expect(rows[1]).toEqual({ kind: "added", text: "new line", pieces: null });
  });

  it("answers a 20,000 character text with nothing in common", () => {
    const before = Array.from({ length: 5000 }, (_, i) => `a${i}`).join("\n");
    const after = Array.from({ length: 5000 }, (_, i) => `b${i}`).join("\n");
    const started = performance.now();
    const rows = diffLines(before, after);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(countRows(rows)).toEqual({ gone: 5000, added: 5000 });
  });
});

describe("wordMarks", () => {
  it("marks what went in the old line and what came in the new", () => {
    expect(wordMarks("Retry three times", "Retry five times")).toEqual({
      was: [
        { text: "Retry ", marked: false },
        { text: "three", marked: true },
        { text: " times", marked: false },
      ],
      now: [
        { text: "Retry ", marked: false },
        { text: "five", marked: true },
        { text: " times", marked: false },
      ],
    });
  });
});

describe("foldRows", () => {
  const same = (n: number): DiffRow[] =>
    Array.from({ length: n }, (_, i) => ({ kind: "same", text: `s${i}` }));
  const gone: DiffRow = { kind: "gone", text: "x", pieces: null };

  it("folds a run of more than four, keeping one line each side", () => {
    const folded = foldRows([gone, ...same(11), gone]);
    expect(folded.map((r) => r.kind)).toEqual(["gone", "same", "fold", "same", "gone"]);
    const fold = folded[2];
    expect(fold.kind === "fold" && fold.rows.length).toBe(9);
  });

  it("leaves a run of four as it is", () => {
    expect(foldRows([gone, ...same(4), gone]).map((r) => r.kind)).toEqual([
      "gone",
      "same",
      "same",
      "same",
      "same",
      "gone",
    ]);
  });
});

describe("the words", () => {
  it("counts the changes", () => {
    expect(countSaid({ gone: 2, added: 5 })).toBe("2 lines taken away · 5 added");
    expect(countSaid({ gone: 1, added: 0 })).toBe("1 line taken away");
    expect(countSaid({ gone: 0, added: 3 })).toBe("3 lines added");
    expect(countSaid({ gone: 0, added: 0 })).toBe("No line changed");
  });

  it("names a fold", () => {
    expect(foldSaid(9)).toBe("9 lines the same");
    expect(foldSaid(1)).toBe("1 line the same");
  });
});

describe("the walk", () => {
  /** The length of the longest common run of lines, the slow way. */
  function lcs(a: string[], b: string[]): number {
    const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    return t[0][0];
  }

  it("keeps the most lines and rebuilds both texts, on many random pairs", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 300; round++) {
      const pick = () =>
        Array.from({ length: Math.floor(rand() * 12) }, () => "abcd"[Math.floor(rand() * 4)]);
      const a = pick();
      const b = pick();
      const rows = diffLines(a.join("\n"), b.join("\n"));
      const before = rows.filter((r) => r.kind !== "added").map((r) => r.text);
      const after = rows.filter((r) => r.kind !== "gone").map((r) => r.text);
      expect(before.join("\n")).toBe(a.join("\n"));
      expect(after.join("\n")).toBe(b.join("\n"));
      expect(rows.filter((r) => r.kind === "same").length).toBe(
        lcs(linesOf(a.join("\n")), linesOf(b.join("\n"))),
      );
    }
  });
});
