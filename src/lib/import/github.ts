/**
 * A GitHub project, read from the JSON of `gh project item-list`.
 *
 * The file is a flat list of items. Each field value sits under the field's
 * name with its first letter lowercased, and every single-select, text and
 * date value is a plain string, so nothing here can tell their types apart.
 * That is why only the fields with a meaning of their own are read — Status,
 * Labels and Assignees — and every other one is named as left behind.
 *
 * Nothing here touches the database or the clock.
 */

import {
  MAX_CARDS,
  SOURCE_NAMES,
  tooMany,
  type Dropped,
  type Source,
  type SourceCard,
  type SourceLabel,
  type SourceList,
  type SourceMember,
  type SourceRead,
} from "./source";

/** The command the preview and the docs name. */
export const GH_COMMAND =
  "gh project item-list <number> --owner <owner> --format json --limit 2000";

/**
 * The keys an item carries that this reader takes or that say nothing new.
 *
 * `title` and `repository` are GitHub's own fields and repeat what `content`
 * already holds; the rest are read below.
 */
const KNOWN = new Set(["id", "content", "title", "repository", "status", "labels", "assignees"]);

/** Two fields the preview names on their own, because people will look for them. */
const LINKED = "linked pull requests";
const REVIEWERS = "reviewers";

/** Keys of `Dropped` that are a field's name, not a count of something. */
const FIELD = "field:";

/** GitHub, as the import names it and speaks of it. */
export const GITHUB: Source = {
  word: "github",
  name: SOURCE_NAMES.github,
  untitled: "Untitled item",
  assigned: (who) => `Assigned on GitHub to ${who}.`,
  /* The file carries no comments, so nothing is ever written with this. */
  wrote: (author) => `**${author}** wrote on GitHub:`,
  leftBehind: (dropped) => {
    const said: string[] = [];
    const fields = Object.keys(dropped)
      .filter((key) => key.startsWith(FIELD))
      .map((key) => key.slice(FIELD.length));
    if (fields.length) {
      said.push(`${listed(fields)} ${fields.length === 1 ? "is" : "are"} not brought in.`);
    }
    const line = (n: number | undefined, one: string, many: string) => {
      if (n && n > 0) said.push(`${n} ${n === 1 ? one : many}`);
    };
    line(
      dropped.linked,
      "item links a pull request; that link is left behind.",
      "items link pull requests; those links are left behind.",
    );
    line(
      dropped.reviewers,
      "item names reviewers; they are left behind.",
      "items name reviewers; they are left behind.",
    );
    line(
      dropped.unread,
      "item this token could not read is left behind.",
      "items this token could not read are left behind.",
    );
    return said;
  },
  closing: [
    "The file never carries comments, open or closed state, sub-issue links, archived items, empty columns or the column order.",
  ],
};

/** A file of `gh project item-list` has items and a total. */
export function isGitHub(file: Record<string, unknown>): boolean {
  return Array.isArray(file.items) && typeof file.totalCount === "number";
}

/* ------------------------------------------------------------------ */

type Raw = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function words(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .map((v) => v.trim())
    : [];
}

/** "A", "A and B", "A, B and C". */
function listed(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
}

/** A key as people read it: gh lowercased only its first letter. */
function fieldName(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** A value that says nothing: a field no item filled in is not left behind. */
function empty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Reads a parsed file that `isGitHub` already knows. */
export function readGitHubFile(file: Raw): SourceRead {
  const items = Array.isArray(file.items)
    ? file.items.filter((v): v is Raw => !!v && typeof v === "object" && !Array.isArray(v))
    : [];
  if (items.length > MAX_CARDS) return { ok: false, said: tooMany(items.length) };

  const lists: SourceList[] = [];
  const listOf = new Map<string, string>();
  const labels: SourceLabel[] = [];
  const members: SourceMember[] = [];
  const cards: SourceCard[] = [];
  const seen = new Set<string>();
  const fields = new Set<string>();
  const dropped: Dropped = { unread: 0, linked: 0, reviewers: 0 };

  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      if (!key || KNOWN.has(key) || empty(value)) continue;
      if (key === LINKED) dropped.linked += 1;
      else if (key === REVIEWERS) dropped.reviewers += 1;
      else fields.add(fieldName(key));
    }

    const content = item.content;
    if (!content || typeof content !== "object") {
      dropped.unread += 1;
      continue;
    }
    const c = content as Raw;
    const itemId = text(item.id);
    /* Only a web address becomes a link; anything else is not one to follow. */
    const url = /^https?:\/\//i.test(text(c.url)) ? text(c.url) : "";
    const isDraft = text(c.type) === "DraftIssue" || !url;
    /* An issue is the same issue in every project that holds it, so its
       address is its id here; a draft lives in one project only. */
    const id = isDraft ? itemId : url;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const status = text(item.status).trim();
    let listId: string | null = null;
    if (status) {
      listId = listOf.get(status) ?? null;
      if (!listId) {
        listId = `status:${status}`;
        listOf.set(status, listId);
        lists.push({ id: listId, name: status, pos: lists.length });
      }
    }

    const labelIds: string[] = [];
    for (const name of words(item.labels)) {
      const labelId = `label:${name}`;
      if (!labels.some((l) => l.id === labelId)) labels.push({ id: labelId, name });
      if (!labelIds.includes(labelId)) labelIds.push(labelId);
    }

    const memberIds: string[] = [];
    for (const login of words(item.assignees)) {
      const memberId = `login:${login}`;
      if (!members.some((m) => m.id === memberId)) members.push({ id: memberId, name: login });
      if (!memberIds.includes(memberId)) memberIds.push(memberId);
    }

    const repo = text(c.repository);
    const number = typeof c.number === "number" ? c.number : null;
    cards.push({
      id,
      shortLink: !isDraft && repo && number !== null ? `${repo}#${number}` : itemId,
      name: text(c.title).trim(),
      desc: text(c.body),
      listId,
      pos: cards.length,
      link: isDraft ? null : url,
      due: null,
      closed: false,
      labelIds,
      memberIds,
      checklist: [],
      comments: [],
    });
  }

  for (const name of fields) dropped[`${FIELD}${name}`] = 1;

  const total = typeof file.totalCount === "number" ? file.totalCount : items.length;
  const warning =
    items.length < total
      ? `This file holds ${items.length} of the project's ${total} items. Export it again with --limit 2000 to bring them all.`
      : null;

  return {
    ok: true,
    board: {
      source: GITHUB,
      name: "A GitHub project",
      lists,
      labels,
      members,
      cards,
      dropped,
      warning,
    },
  };
}
