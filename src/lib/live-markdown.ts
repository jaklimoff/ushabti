import {
  defineLanguageFacet,
  ensureSyntaxTree,
  Language,
  LanguageSupport,
  syntaxTree,
} from "@codemirror/language";
import { GFM, parser } from "@lezer/markdown";
import { EditorState, RangeSetBuilder, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/**
 * Obsidian's Live Preview, on our own: the source is always the markdown, and
 * the marks hide on every line but the ones the cursor is on.
 *
 * The parser is Lezer's markdown with GFM, which is what marked reads with
 * `gfm`. It is built here and not taken from `@codemirror/lang-markdown`,
 * which brings HTML, CSS and JavaScript highlighting and autocomplete along:
 * 130 KB gzipped that a description never uses.
 * `breaks` changes nothing here, because a line of source is a line on the
 * screen either way. Tables stay plain on purpose.
 *
 * `pieces()` decides and draws nothing, so a test can ask it what a line will
 * look like; `livePreview()` turns the answer into decorations.
 */

/** One thing the preview does to a stretch of the source. */
export type Piece =
  | { kind: "hide"; from: number; to: number }
  | { kind: "style"; from: number; to: number; style: Style }
  | { kind: "line"; at: number; style: LineStyle }
  | { kind: "image"; from: number; to: number; src: string; alt: string }
  | { kind: "task"; from: number; to: number; done: boolean };

export type Style = "strong" | "em" | "strike" | "code" | "link";
export type LineStyle = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "code" | "fence";

/** A file of the task, the only image the editor draws. A link to elsewhere stays words. */
const ATTACHMENT = /^\/api\/attachments\/[\w-]+$/;

const INLINE: Record<string, Style> = {
  StrongEmphasis: "strong",
  Emphasis: "em",
  Strikethrough: "strike",
  InlineCode: "code",
  Link: "link",
};

/** The lines any part of the selection touches. Those show their source. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) lines.add(n);
  }
  return lines;
}

export function pieces(state: EditorState): Piece[] {
  const out: Piece[] = [];
  const active = activeLines(state);
  const doc = state.doc;
  const lineOf = (pos: number) => doc.lineAt(pos).number;
  const quiet = (from: number, to: number) => {
    for (let n = lineOf(from); n <= lineOf(to); n++) if (active.has(n)) return false;
    return true;
  };
  /* A description is short, so the whole tree is parsed at once. A long one
     falls back to what the background parse has. */
  const tree = ensureSyntaxTree(state, doc.length, 50) ?? syntaxTree(state);

  tree.iterate({
    enter: (node) => {
      const { name, from, to } = node;
      const heading = /^ATXHeading([1-6])$/.exec(name);
      if (heading) {
        out.push({ kind: "line", at: doc.lineAt(from).from, style: `h${heading[1]}` as LineStyle });
        return;
      }
      if (name === "HeaderMark") {
        // "# " goes as one, so the heading does not start with a space.
        const end = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
        if (node.node.parent?.name.startsWith("ATXHeading") && quiet(from, end))
          out.push({ kind: "hide", from, to: end });
        return;
      }
      if (name === "FencedCode") {
        const open = quiet(from, to);
        for (let n = lineOf(from); n <= lineOf(to); n++) {
          const line = doc.line(n);
          const edge = n === lineOf(from) || n === lineOf(to);
          out.push({ kind: "line", at: line.from, style: edge && open ? "fence" : "code" });
          if (edge && open && line.to > line.from)
            out.push({ kind: "hide", from: line.from, to: line.to });
        }
        // Nothing inside a fence is markdown.
        return false;
      }
      if (name === "Table") return false;
      const style = INLINE[name];
      if (style) out.push({ kind: "style", from, to, style });
      if (name === "EmphasisMark" || name === "StrikethroughMark" || name === "CodeMark") {
        if (quiet(from, to)) out.push({ kind: "hide", from, to });
        return;
      }
      if (name === "Link" && quiet(from, to)) {
        /* "[words](url)": the bracket in front, and everything from the
           closing bracket on. */
        const marks = node.node.getChildren("LinkMark");
        if (marks.length >= 2) {
          out.push({ kind: "hide", from: marks[0].from, to: marks[0].to });
          out.push({ kind: "hide", from: marks[1].from, to });
        }
        return false;
      }
      if (name === "Image") {
        const url = node.node.getChild("URL");
        const src = url ? doc.sliceString(url.from, url.to) : "";
        if (ATTACHMENT.test(src) && quiet(from, to)) {
          const marks = node.node.getChildren("LinkMark");
          const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : "";
          out.push({ kind: "image", from, to, src, alt });
        }
        return false;
      }
      if (name === "TaskMarker") {
        const text = doc.sliceString(from, to);
        if (quiet(from, to)) {
          // The "- " goes with the box, so the line opens with the box.
          const item = node.node.parent?.parent;
          const mark = item?.getChild("ListMark");
          if (mark) out.push({ kind: "hide", from: mark.from, to: from });
          out.push({ kind: "task", from, to, done: /x/i.test(text) });
        }
        return;
      }
    },
  });
  return out;
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.className = "cm-lp-image";
    return img;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    readonly at: number,
    readonly done: boolean,
  ) {
    super();
  }
  eq(other: TaskWidget) {
    return other.at === this.at && other.done === this.done;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.done;
    box.className = "cm-lp-task";
    box.setAttribute("aria-label", this.done ? "Done" : "Not done");
    /* A tick is a write to the words: "[ ]" becomes "[x]". The press keeps the
       caret where it was, so the line does not open under the finger. */
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      view.dispatch({
        changes: { from: this.at + 1, to: this.at + 2, insert: this.done ? " " : "x" },
      });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

function decorate(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const all = pieces(state).map((p) => {
    if (p.kind === "line")
      return { from: p.at, to: p.at, deco: Decoration.line({ class: `cm-lp-${p.style}` }) };
    if (p.kind === "hide") return { from: p.from, to: p.to, deco: Decoration.replace({}) };
    if (p.kind === "style")
      return { from: p.from, to: p.to, deco: Decoration.mark({ class: `cm-lp-${p.style}` }) };
    if (p.kind === "image")
      return {
        from: p.from,
        to: p.to,
        deco: Decoration.replace({ widget: new ImageWidget(p.src, p.alt) }),
      };
    return {
      from: p.from,
      to: p.to,
      deco: Decoration.replace({ widget: new TaskWidget(p.from, p.done) }),
    };
  });
  /* The builder wants them in order, and a line before a mark at one place. */
  all.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide || a.to - b.to);
  for (const { from, to, deco } of all) builder.add(from, to, deco);
  return builder.finish();
}

const preview = StateField.define<DecorationSet>({
  create: decorate,
  update: (deco, tr) => (tr.docChanged || tr.selection ? decorate(tr.state) : deco),
  provide: (field) => EditorView.decorations.from(field),
});

const markdown = new Language(defineLanguageFacet(), parser.configure(GFM), [], "markdown");

/** The language and the preview, which is all a box needs to read as rendered. */
export function livePreview(): Extension {
  return [new LanguageSupport(markdown), preview];
}
