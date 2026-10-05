import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { previewContextFor } from "../live-context";
import { livePreview, pieces, previewContext, type Piece } from "../live-markdown";
import type { TaskLinks } from "../task-keys";
import type { FileFacts } from "../uploads";

/** What the page tells the box; null tells it nothing. */
type Told = { files?: FileFacts[]; links?: TaskLinks } | null;

/** The words as the preview draws them: hidden stretches gone, widgets named. */
function drawn(doc: string, cursor?: number | EditorSelection, told: Told = {}) {
  const state = EditorState.create({
    doc,
    selection: typeof cursor === "number" ? EditorSelection.cursor(cursor) : cursor,
    extensions: [
      livePreview(),
      told ? previewContext.of(previewContextFor(told.files ?? [], told.links ?? null)) : [],
    ],
  });
  const all = pieces(state);
  const cuts = all
    .filter((p): p is Extract<Piece, { from: number }> => p.kind !== "line" && p.kind !== "style")
    .sort((a, b) => a.from - b.from);
  let out = "";
  let at = 0;
  for (const p of cuts) {
    if (p.from < at) continue;
    out += doc.slice(at, p.from);
    if (p.kind === "image") out += `<img ${p.src}>`;
    if (p.kind === "video") out += `<video ${p.src}>`;
    if (p.kind === "download") out += `<${p.words}>`;
    if (p.kind === "task") out += p.done ? "[✓]" : "[☐]";
    at = p.to;
  }
  return { text: out + doc.slice(at), all };
}

// The cursor sits at the end of a last, empty line, so no line above is active.
const away = (doc: string, told?: Told) => drawn(`${doc}\n\n`, doc.length + 2, told);

const FILE = "0a1b2c3d-0000-4000-8000-00000000000f";

describe("live preview", () => {
  it("hides the heading mark and sizes the line", () => {
    const { text, all } = away("## Plan");
    expect(text.trim()).toBe("Plan");
    expect(all).toContainEqual({ kind: "line", at: 0, style: "h2" });
  });

  it("hides bold, italic, strikethrough and inline code marks and keeps their style", () => {
    const { text, all } = away("**b** *i* ~~s~~ `c`");
    expect(text.trim()).toBe("b i s c");
    const styles = all.flatMap((p) => (p.kind === "style" ? [p.style] : []));
    expect(styles).toEqual(["strong", "em", "strike", "code"]);
  });

  it("shows the source on the line the cursor is on, and only there", () => {
    const doc = "**one**\n**two**";
    expect(drawn(doc, 3).text).toBe("**one**\ntwo");
    expect(drawn(doc, 11).text).toBe("one\n**two**");
  });

  it("draws a link as its words", () => {
    expect(away("see [the docs](https://x.y/z) now").text.trim()).toBe("see the docs now");
  });

  it("draws an attachment as an image, and leaves any other image as words", () => {
    expect(away(`![a](/api/attachments/${FILE})`).text.trim()).toBe(
      `<img /api/attachments/${FILE}>`,
    );
    expect(away("![a](https://evil.example/x.png)").text.trim()).toBe(
      "![a](https://evil.example/x.png)",
    );
  });

  it("fetches no file at all when the page told it nothing", () => {
    const image = `![a](/api/attachments/${FILE})`;
    expect(away(image, null).text.trim()).toBe(image);
  });

  it("draws a task item as a tick box", () => {
    expect(away("- [ ] open\n- [x] shut").text.trim()).toBe("[☐] open\n[✓] shut");
  });

  it("hides the fences of a code block and leaves the code as it is", () => {
    const { text, all } = away("```js\nconst a = **1**;\n```");
    expect(text.trim()).toBe("const a = **1**;");
    expect(all.filter((p) => p.kind === "line").map((p) => p.kind === "line" && p.style)).toEqual([
      "fence",
      "code",
      "fence",
      "gap",
    ]);
  });

  it("shows the fences while the cursor is inside the block", () => {
    const doc = "```js\ncode\n```";
    expect(drawn(doc, 8).text).toBe(doc);
  });

  it("leaves a table as plain source", () => {
    const table = "| a | b |\n| - | - |\n| **1** | 2 |";
    expect(away(table).text.trim()).toBe(table);
  });

  it("strikes a single tilde, as marked does, and leaves a tilde that is not closed", () => {
    const { text, all } = away("~one~ and ~~two~~ and ~a~~");
    expect(text.trim()).toBe("one and two and ~a~~");
    expect(all.filter((p) => p.kind === "style").map((p) => p.kind === "style" && p.style)).toEqual(
      ["strike", "strike"],
    );
  });

  it("shows the marks of every line a selection touches", () => {
    const doc = "**one**\n**two**\n**three**";
    expect(drawn(doc, EditorSelection.single(2, 10)).text).toBe("**one**\n**two**\nthree");
  });

  it("draws a file by its mime in the task's list: a player, or its name and size", () => {
    const video = { id: FILE, name: "clip.mp4", mime: "video/mp4", size: 10 };
    expect(away(`![clip](/api/attachments/${FILE})`, { files: [video] }).text.trim()).toBe(
      `<video /api/attachments/${FILE}>`,
    );
    const pdf = { id: FILE, name: "plan.pdf", mime: "application/pdf", size: 2048 };
    expect(away(`![plan](/api/attachments/${FILE})`, { files: [pdf] }).text.trim()).toBe(
      "<plan.pdf (2 KiB)>",
    );
  });

  it("draws the key of a known task as a link, and leaves code and unknown keys alone", () => {
    const links = { projectId: "p1", projectKey: "USH", keys: ["USH-1"] };
    const { all } = away("see ush-1, `USH-1`, [x](/USH-1) and USH-2", { links });
    const keys = all.filter((p) => p.kind === "key");
    expect(keys).toEqual([{ kind: "key", from: 4, to: 9, key: "USH-1", href: "/p/p1?task=USH-1" }]);
  });

  it("draws the marks inside a link's words, as the page does", () => {
    const { text, all } = away("[another *one*](/x)");
    expect(text.trim()).toBe("another one");
    expect(all.flatMap((p) => (p.kind === "style" ? [p.style] : []))).toEqual(["link", "em"]);
  });

  it("keeps the last line of a fence nobody closed, as code", () => {
    // A quote ends the fence inside it, so the cursor below is outside it.
    const { text, all } = away("> ```\n> const a = 1;\n> const b = 2;");
    expect(text.trim()).toBe("> const a = 1;\n> const b = 2;");
    expect(all.flatMap((p) => (p.kind === "line" ? [p.style] : []))).toEqual([
      "fence",
      "code",
      "code",
      "gap",
    ]);
  });

  const lines = (all: Piece[]) => all.flatMap((p) => (p.kind === "line" ? [[p.at, p.style]] : []));

  it("draws a blank line between two blocks as the page's gap, not a full line", () => {
    const doc = "one\n\ntwo\n\nthree";
    expect(lines(drawn(doc, 0).all)).toEqual([
      [4, "gap"],
      [9, "gap"],
    ]);
  });

  it("folds a run of blank lines into the one gap the page draws", () => {
    const doc = "one\n\n\n\ntwo";
    expect(lines(drawn(doc, 0).all)).toEqual([
      [4, "gap"],
      [5, "folded"],
      [6, "folded"],
    ]);
    // The cursor's blank line is whole, and the run starts again under it.
    expect(lines(drawn(doc, 5).all)).toEqual([
      [4, "gap"],
      [6, "gap"],
    ]);
  });

  it("leaves a blank line inside an indented code block as code", () => {
    expect(lines(drawn("x\n\n    a\n\n    b", 0).all)).toEqual([[2, "gap"]]);
  });

  it("gives a blank line its full height back while the cursor is on it", () => {
    const doc = "one\n\ntwo";
    expect(lines(drawn(doc, 4).all)).toEqual([]);
  });

  it("leaves a blank line inside a code block as code", () => {
    const { all } = drawn("x\n```\na\n\nb\n```", 0);
    expect(lines(all)).toEqual([
      [2, "fence"],
      [6, "code"],
      [8, "code"],
      [9, "code"],
      [11, "fence"],
    ]);
  });

  it("styles the code between the backticks, so the marks sit beside its box", () => {
    const doc = "see `c` now";
    const style = (all: Piece[]) => all.find((p) => p.kind === "style");
    expect(style(drawn(doc, 0).all)).toEqual({ kind: "style", from: 5, to: 6, style: "code" });
    expect(drawn(doc, 0).text).toBe("see `c` now");
    expect(style(away(doc).all)).toEqual({ kind: "style", from: 5, to: 6, style: "code" });
  });
});
