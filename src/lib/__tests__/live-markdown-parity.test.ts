import { Marked, type Token, type Tokens } from "marked";
import { describe, expect, it } from "vitest";
import { markdownParser } from "../live-markdown";
import { renderMarkdown } from "../task-keys";

/* marked as the page sets it up. The first test holds this to
   `renderMarkdown()`, so the two cannot drift apart. */
const marked = new Marked({ gfm: true, breaks: true });

/*
 * The box and the page read one text. If the editor's parser and marked
 * disagree, a person sees one thing while typing and another once saved, and
 * an agent reads words that look different again. So one fixture goes through
 * both, and each construct is named the same way from either side.
 */
const FIXTURE = `# One heading
## Two *headings*

Some **bold**, some *italic*, some __bold__ and _italic_, and **bold *inside*** too.
A snake_case_word stays words, and so does 2*3*4.

~one~ tilde and ~~two~~ tildes, a~mid~word, and ~not closed~~ here.

A [link](https://example.com/a) and [another *one*](/p/x?task=USH-1).
![a picture](/api/attachments/0a1b2c3d-0000-4000-8000-00000000000f)

- [ ] open item
- [x] done item
- plain item

Inline \`code **here**\` and more.

\`\`\`js
const a = **1**;
\`\`\`
`;

/** What the page reads, in the words the test compares. */
function fromMarked(text: string): string[] {
  const out: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === "heading") out.push(`h${(t as Tokens.Heading).depth}:${t.text}`);
      if (t.type === "strong") out.push(`strong:${t.text}`);
      if (t.type === "em") out.push(`em:${t.text}`);
      if (t.type === "del") out.push(`strike:${t.text}`);
      if (t.type === "link") out.push(`link:${t.text}->${(t as Tokens.Link).href}`);
      if (t.type === "image") out.push(`image:${t.text}->${(t as Tokens.Image).href}`);
      if (t.type === "codespan") out.push(`code:${t.text}`);
      if (t.type === "code") out.push(`fence:${t.text}`);
      if (t.type === "list_item" && (t as Tokens.ListItem).task)
        out.push(`task:${(t as Tokens.ListItem).checked ? "x" : " "}`);
      if (t.type === "list") walk((t as Tokens.List).items);
      // A fenced block holds no inline markdown, whatever its words say.
      if ("tokens" in t && t.tokens && t.type !== "code") walk(t.tokens);
    }
  };
  walk(marked.lexer(text));
  return out.sort();
}

/** What the box reads, named as above. */
function fromLezer(text: string): string[] {
  const out: string[] = [];
  const slice = (from: number, to: number) => text.slice(from, to);
  markdownParser.parse(text).iterate({
    enter: (node) => {
      const n = node.node;
      const heading = /^ATXHeading([1-6])$/.exec(node.name);
      if (heading) {
        const mark = n.getChild("HeaderMark")!;
        out.push(`h${heading[1]}:${slice(mark.to, node.to).trim()}`);
      }
      const inner = (mark: string) => {
        const marks = n.getChildren(mark);
        return slice(marks[0].to, marks[marks.length - 1].from);
      };
      if (node.name === "StrongEmphasis") out.push(`strong:${inner("EmphasisMark")}`);
      if (node.name === "Emphasis") out.push(`em:${inner("EmphasisMark")}`);
      if (node.name === "Strikethrough") out.push(`strike:${inner("StrikethroughMark")}`);
      if (node.name === "InlineCode") out.push(`code:${inner("CodeMark")}`);
      if (node.name === "Link" || node.name === "Image") {
        const marks = n.getChildren("LinkMark");
        const url = n.getChild("URL")!;
        const kind = node.name === "Link" ? "link" : "image";
        out.push(`${kind}:${slice(marks[0].to, marks[1].from)}->${slice(url.from, url.to)}`);
      }
      if (node.name === "FencedCode") {
        const code = n.getChild("CodeText");
        out.push(`fence:${code ? slice(code.from, code.to) : ""}`);
        return false;
      }
      if (node.name === "TaskMarker")
        out.push(`task:${/x/i.test(slice(node.from, node.to)) ? "x" : " "}`);
    },
  });
  return out.sort();
}

describe("the editor's parser and marked", () => {
  it("are tested against the marked the page draws with", () => {
    expect(renderMarkdown(FIXTURE)).toBe(marked.parse(FIXTURE));
  });

  it("read every construct of the fixture the same", () => {
    const page = fromMarked(FIXTURE);
    expect(fromLezer(FIXTURE)).toEqual(page);
    // The fixture is only worth something while it holds each construct.
    for (const kind of [
      "h1",
      "h2",
      "strong",
      "em",
      "strike",
      "link",
      "image",
      "task",
      "code",
      "fence",
    ])
      expect(page.some((p) => p.startsWith(`${kind}:`))).toBe(true);
  });

  it("strike a single tilde, as marked with gfm does", () => {
    expect(fromLezer("~one~")).toEqual(["strike:one"]);
    expect(fromMarked("~one~")).toEqual(["strike:one"]);
  });
});
