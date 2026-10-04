/**
 * A file in the markdown, and the lines an upload writes while it runs.
 *
 * The markdown names a file by its route, `![name](/api/attachments/{id})`,
 * which is what an agent pastes too. The route says nothing about what the
 * file is, so the drawing asks the task's own file list: an image stays an
 * image, a video becomes a player, anything else a link with its size.
 * A file the list does not hold is drawn as it was written.
 *
 * Everything here is pure, so the browser and a test read the same answers.
 */

import { formatBytes, isImage, isInline } from "./attachments";

/** What the markdown needs to know of a file to draw it. */
export type FileFacts = { id: string; name: string; mime: string; size: number };

const ROUTE =
  /^\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The id of a file this board serves, or null for any other address. */
export function attachmentIdOf(href: string): string | null {
  return ROUTE.exec(href)?.[1] ?? null;
}

/**
 * Whether a player may load this address. The sanitiser lets a `<video>`
 * through only for a file of this board, so a description cannot make every
 * reader's browser fetch a stranger's address.
 */
export function allowedVideoSrc(src: string | null): boolean {
  return !!src && attachmentIdOf(src) !== null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** How a file is drawn: as an image, as a player, or as its name and size. */
export type FileLook =
  { kind: "image" } | { kind: "video"; name: string } | { kind: "download"; words: string };

/** The page and the live box both draw a file by this, so it reads one way. */
export function lookOf(file: FileFacts): FileLook {
  if (isImage(file.mime)) return { kind: "image" };
  if (isInline(file.mime)) return { kind: "video", name: file.name };
  return { kind: "download", words: `${file.name} (${formatBytes(file.size)})` };
}

/**
 * The HTML that draws a file, or null when the image marked draws is right.
 * The caller sanitises it, as it does all markdown.
 */
export function fileHtml(file: FileFacts): string | null {
  const look = lookOf(file);
  const src = `/api/attachments/${file.id}`;
  if (look.kind === "image") return null;
  if (look.kind === "video")
    return `<video controls preload="metadata" src="${src}" title="${escapeHtml(look.name)}"></video>`;
  return `<a href="${src}">${escapeHtml(look.words)}</a>`;
}

/** The line that stands where a file will go while it uploads. */
export function uploadingLine(name: string, percent: number): string {
  return `Uploading ${name}… ${percent}%`;
}

/**
 * The words without any upload line. A line stands for a file that is not
 * there yet, so it is never what gets saved: a save that cannot wait takes
 * the words without it, and a line an upload left when it was stopped is
 * not shown again.
 */
export function withoutUploadLines(text: string): string {
  return text
    .replace(/^Uploading .+… \d{1,3}%(?:\n|$)/gm, "")
    .replace(/\n$/, (end) => (text.endsWith("\n") ? end : ""));
}

/**
 * Puts the lines at the cursor, each on a line of its own, and answers where
 * the cursor goes: after them, so the typing goes on below.
 */
export function insertLines(
  text: string,
  caret: number,
  lines: string[],
): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const head = before && !before.endsWith("\n") ? "\n" : "";
  const tail = after && !after.startsWith("\n") ? "\n" : "";
  const middle = head + lines.join("\n") + tail;
  return { text: before + middle + after, caret: at + middle.length };
}

/**
 * Swaps the first copy of one line for another. Null says the line is gone:
 * somebody deleted it, and the file is not put back in their words.
 */
export function replaceFirst(text: string, from: string, to: string): string | null {
  const at = text.indexOf(from);
  if (at < 0) return null;
  return text.slice(0, at) + to + text.slice(at + from.length);
}
