/**
 * A task key written in a description or a comment, and the link it becomes.
 *
 * People and agents write keys all day — "waits on USH-12" — and a key that
 * is plain text has to be copied into the search. So the markdown draws a key
 * of this project as a link to that task. Nothing is stored: the saved text
 * stays what was written, so the API and an agent read the raw words.
 *
 * Only a key that names a task on the board or in the archive becomes a link.
 * A deleted task is not in the board data, so on the client it reads exactly
 * as an unknown key does, and both stay plain text. A key of another project
 * is never looked at.
 */

import { Marked, type Token, type Tokens } from "marked";
import { attachmentIdOf, fileHtml, type FileFacts } from "./uploads";

/** A key found in a piece of text, where it sits, and how it was written. */
export type KeyMatch = { index: number; written: string; key: string };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every key of this project in the text, in any letter case.
 *
 * A key is a word of its own. A letter, a digit, `_` or `-` before it, or
 * after its number, means it is part of something longer: `xUSH-12` is not a
 * key, and `USH-123` is never `USH-12`.
 */
export function taskKeysIn(text: string, projectKey: string): KeyMatch[] {
  if (!projectKey) return [];
  const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(projectKey)}-\\d+(?![\\w-])`, "gi");
  const found: KeyMatch[] = [];
  for (const m of text.matchAll(pattern)) {
    found.push({ index: m.index, written: m[0], key: m[0].toUpperCase() });
  }
  return found;
}

/** What turning keys into links needs to know about the board. */
export type TaskLinks = {
  projectId: string;
  projectKey: string;
  /** The keys of every task on the board and in the archive. */
  keys: Iterable<string>;
};

/** A key that names a task, as the markdown carries it until it is drawn. */
type TaskKeyToken = { type: "taskKey"; raw: string; text: string; key: string; href: string };

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const markdown = new Marked(
  { gfm: true, breaks: true },
  {
    extensions: [
      {
        name: "taskKey",
        renderer(token) {
          const { text, key, href } = token as unknown as TaskKeyToken;
          return `<a href="${escapeHtml(href)}" data-task-key="${escapeHtml(key)}">${escapeHtml(text)}</a>`;
        },
      },
    ],
  },
);

/* A raw `<a>`, `<code>` or `<pre>` typed into the markdown is html to marked,
   and the words inside it are plain text tokens between two tags. */
const OPENS = /^<(a|code|pre)(?=[\s>/])/i;
const CLOSES = /^<\/(a|code|pre)\s*>/i;

/**
 * The markdown as HTML, with every key of a known task drawn as a link.
 *
 * The HTML is not safe yet: the caller sanitises it, as it does all markdown.
 * A key inside inline code, a code block or a link stays as it was written,
 * because a link inside a link is two answers to one click, and code is
 * quoted words.
 *
 * `files` is the task's own file list. A file the markdown names is drawn by
 * its mime from there, never by its address; see `uploads.ts`.
 */
export function renderMarkdown(
  text: string,
  links?: TaskLinks | null,
  files?: Iterable<FileFacts> | null,
): string {
  const tokens = markdown.lexer(text ?? "");
  if (links) {
    const known = new Map<string, string>();
    for (const key of links.keys) known.set(key.toUpperCase(), key);
    let quoted = 0;

    const link = (list: Token[], blocks = false) => {
      for (let i = 0; i < list.length; i++) {
        const token = list[i];
        if (blocks) quoted = 0;
        if (token.type === "html") {
          // A block of raw html is drawn as it was written, and holds no token.
          if ((token as Tokens.HTML).block) continue;
          const tag = (token as Tokens.HTML).text.trim();
          if (OPENS.test(tag) && !/\/>$/.test(tag)) quoted++;
          else if (CLOSES.test(tag)) quoted = Math.max(0, quoted - 1);
          continue;
        }
        if (["link", "image", "codespan", "code"].includes(token.type)) continue;
        if (token.type === "list") {
          link((token as Tokens.List).items);
          continue;
        }
        if (token.type === "table") {
          const table = token as Tokens.Table;
          for (const cell of table.header) link(cell.tokens);
          for (const row of table.rows) for (const cell of row) link(cell.tokens);
          continue;
        }
        if ("tokens" in token && token.tokens) {
          link(token.tokens);
          continue;
        }
        if (token.type !== "text" || quoted > 0) continue;
        const plain = token as Tokens.Text;
        /* Marked leaves every word after a raw <code> or <pre> unescaped, to
           the end of the text, even past a tag left open. The count above says
           what is quoted; the pieces keep marked's flag, so they are drawn as
           marked would draw them, and the sanitiser still runs on all of it. */
        const pieces = split(plain.text, !!plain.escaped, links, known);
        if (!pieces) continue;
        list.splice(i, 1, ...pieces);
        i += pieces.length - 1;
      }
    };
    /* A raw tag left open ends with its block, as the browser ends it, so it
       cannot quiet the keys of the rest of the text. */
    link(tokens, true);
  }
  /* After the keys: the link a file becomes is raw html, and the pass above
     would read it as a link left open and quiet every key after it. */
  if (files) drawFiles(tokens, files);
  return markdown.parser(tokens);
}

function drawFiles(tokens: Token[], files: Iterable<FileFacts>) {
  const byId = new Map<string, FileFacts>();
  for (const f of files) byId.set(f.id.toLowerCase(), f);
  markdown.walkTokens(tokens, (token) => {
    if (token.type !== "image") return;
    const id = attachmentIdOf((token as Tokens.Image).href);
    const file = id ? byId.get(id.toLowerCase()) : undefined;
    const html = file ? fileHtml(file) : null;
    if (html === null) return;
    const drawn: Tokens.HTML = {
      type: "html",
      raw: token.raw,
      text: html,
      pre: false,
      block: false,
    };
    for (const key of Object.keys(token)) delete (token as unknown as Record<string, unknown>)[key];
    Object.assign(token, drawn);
  });
}

function split(
  text: string,
  escaped: boolean,
  links: TaskLinks,
  known: Map<string, string>,
): Array<Tokens.Text | TaskKeyToken> | null {
  const pieces: Array<Tokens.Text | TaskKeyToken> = [];
  let from = 0;
  for (const { index, written, key, href } of keyLinksIn(text, links, known)) {
    if (index > from) pieces.push(plainText(text.slice(from, index), escaped));
    pieces.push({ type: "taskKey", raw: written, text: written, key, href });
    from = index + written.length;
  }
  if (pieces.length === 0) return null;
  if (from < text.length) pieces.push(plainText(text.slice(from), escaped));
  return pieces;
}

/** A key that names a task, and the address its link opens. */
export type KeyLink = KeyMatch & { href: string };

/**
 * The keys in the text that name a task the board knows, with their links.
 * The page and the live box both ask this, so a key is a link in both or in
 * neither. `known` maps an upper-case key to the key as the board writes it.
 */
export function keyLinksIn(
  text: string,
  links: TaskLinks,
  known = new Map([...links.keys].map((k) => [k.toUpperCase(), k])),
): KeyLink[] {
  return taskKeysIn(text, links.projectKey).flatMap((match) => {
    const key = known.get(match.key);
    if (!key) return [];
    const href = `/p/${encodeURIComponent(links.projectId)}?task=${encodeURIComponent(key)}`;
    return [{ ...match, key, href }];
  });
}

const plainText = (text: string, escaped: boolean): Tokens.Text => ({
  type: "text",
  raw: text,
  text,
  escaped,
});
