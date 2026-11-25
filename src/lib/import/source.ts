/**
 * What every reader of an export hands the import, and the names of the
 * places a board can come from.
 *
 * A reader turns one kind of file into a `SourceBoard` and brings its own
 * words with it. Everything below the reader — the plan, the write, the
 * preview — reads this shape and never a file, so a second kind of export is
 * one more reader and not a second import.
 *
 * It reads no database and no Node module, so the task panel can ask it for
 * the name of a source as well.
 */

/** How large a file may be. A board this size is a board, not a backup. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** How many cards one import may carry. */
export const MAX_CARDS = 2000;

/** The one sentence a file of too many cards is refused with, whatever its source. */
export function tooMany(count: number): string {
  return `That export has ${count} cards. An import takes ${MAX_CARDS} at a time.`;
}

/** The one sentence a file that is too large is refused with, wherever it is
 * read: the route answers it from the header and a reader from the bytes. */
export const TOO_LARGE = "That file is larger than 5 MB. An import takes 5 MB at a time.";

/** A file read as far as JSON, before any reader looks at its shape. */
export type ParsedFile = { ok: true; file: Record<string, unknown> } | { ok: false; said: string };

/** Answers the size and the JSON of a file, which are the same for every source. */
export function parseFile(raw: string): ParsedFile {
  /* Bytes, not characters: the limit is the one the route reads off the
     header. TextEncoder and not Buffer, so this module stays out of Node. */
  if (new TextEncoder().encode(raw).length > MAX_FILE_BYTES) return { ok: false, said: TOO_LARGE };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, said: "That file is not JSON. Export the board again as JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, said: "That file is not a board export." };
  }
  return { ok: true, file: parsed as Record<string, unknown> };
}

/**
 * The word an import line stores, and the name people read for it.
 *
 * The one map of them. A word is written on the feed for good, so a word here
 * is never renamed; a line whose word is not here reads "another board".
 */
export const SOURCE_NAMES: Readonly<Record<string, string>> = {
  trello: "Trello",
  github: "GitHub",
};

/** The name people read for a stored word, or null for one nobody knows. */
export function sourceName(word: unknown): string | null {
  return typeof word === "string" && Object.hasOwn(SOURCE_NAMES, word) ? SOURCE_NAMES[word] : null;
}

/** Counts of what the file holds that a task board cannot take, by kind. */
export type Dropped = Record<string, number>;

/**
 * Where a board came from, and the words that are that source's own.
 *
 * The plan holds no source's words: a title for an item with none, the line
 * that names a person nobody here matches, the head of a comment and what
 * stays behind all come from here.
 */
export type Source = {
  /** Stored on the feed line. A key of `SOURCE_NAMES`. */
  word: string;
  /** What people read. */
  name: string;
  /** The title of an item that had none. */
  untitled: string;
  /** The last line of a description that names a person nobody here is. */
  assigned: (who: string) => string;
  /** The first line of a comment brought in, naming who wrote it. */
  wrote: (author: string) => string;
  /** What will not come, in sentences, said before the import's own. */
  leftBehind: (dropped: Dropped) => string[];
  /** What is said last, after the import's own sentences. */
  closing: string[];
};

export type SourceList = {
  id: string;
  name: string;
  /** The source's own order, and lists are read by it. */
  pos: number;
};

export type SourceLabel = { id: string; name: string };

/** A person on the other board. Most sources carry no email, only a name. */
export type SourceMember = { id: string; name: string };

export type SourceChecklistItem = { text: string; done: boolean };

export type SourceComment = { author: string; text: string; at: string };

export type SourceCard = {
  id: string;
  /** How to find the item again on the other side, such as Trello's short code. */
  shortLink: string;
  name: string;
  desc: string;
  /** The list it sits in, or null for an item with no column. Its task comes
   * in with the group property empty. */
  listId: string | null;
  pos: number;
  /** The address of the item on the other side, or null. It becomes Link. */
  link: string | null;
  /** The moment the source holds, or null. The date part of it becomes Due. */
  due: string | null;
  /** Archived on the other side. */
  closed: boolean;
  labelIds: string[];
  memberIds: string[];
  checklist: SourceChecklistItem[];
  comments: SourceComment[];
};

export type SourceBoard = {
  source: Source;
  name: string;
  lists: SourceList[];
  labels: SourceLabel[];
  members: SourceMember[];
  /** Every card that comes, lists in `pos` order and cards inside them. */
  cards: SourceCard[];
  /**
   * What the file holds that a task board cannot take.
   *
   * It is counted rather than ignored, because the preview says it out loud:
   * somebody who is about to move a year of work deserves to read what will
   * not come with it before they press the button.
   */
  dropped: Dropped;
  /** A sentence the preview says before anything else, such as a file cut
   * short, or null. */
  warning: string | null;
};

export type SourceRead = { ok: true; board: SourceBoard } | { ok: false; said: string };
