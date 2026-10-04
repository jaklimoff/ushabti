import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { livePreview, pieces, type Piece } from "../live-markdown";

/** The words as the preview draws them: hidden stretches gone, widgets named. */
function drawn(doc: string, cursor?: number) {
  const state = EditorState.create({
    doc,
    selection: cursor === undefined ? undefined : EditorSelection.cursor(cursor),
    extensions: livePreview(),
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
    if (p.kind === "task") out += p.done ? "[✓]" : "[☐]";
    at = p.to;
  }
  return { text: out + doc.slice(at), all };
}

// The cursor sits at the end of a last, empty line, so no line above is active.
const away = (doc: string) => drawn(`${doc}\n\n`, doc.length + 2);

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
    expect(away("![a](/api/attachments/abc-1)").text.trim()).toBe("<img /api/attachments/abc-1>");
    expect(away("![a](https://evil.example/x.png)").text.trim()).toBe(
      "![a](https://evil.example/x.png)",
    );
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
});
