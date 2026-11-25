/**
 * A Trello export, read into the few things a board can use.
 *
 * Trello's export is one JSON file and it carries far more than a task board
 * needs. This module is the whole of what we understand of it, Trello's own
 * words included: everything below reads `SourceBoard` and never the file
 * again.
 *
 * Nothing here touches the database or the clock, so the limits and the
 * mapping can both be asked without a server.
 */

import {
  MAX_CARDS,
  parseFile,
  SOURCE_NAMES,
  tooMany,
  type Source,
  type SourceCard,
  type SourceChecklistItem,
  type SourceComment,
  type SourceRead,
} from "./source";

export { MAX_CARDS, MAX_FILE_BYTES, TOO_LARGE } from "./source";
export type { SourceBoard } from "./source";

/**
 * What a Trello file holds that a task board cannot take.
 *
 * It is counted rather than ignored, because the preview says it out loud.
 */
export type TrelloDropped = {
  attachments: number;
  customFields: number;
  starts: number;
  dueComplete: number;
  actions: number;
  archivedLists: number;
  /** Cards of an archived list, and cards whose list is not in the file. */
  homelessCards: number;
};

/** Trello, as the import names it and speaks of it. */
export const TRELLO: Source = {
  word: "trello",
  name: SOURCE_NAMES.trello,
  untitled: "Untitled card",
  assigned: (who) => `Assigned on Trello to ${who}.`,
  wrote: (author) => `**${author}** wrote on Trello:`,
  leftBehind: (dropped) => {
    const d = dropped as Partial<TrelloDropped>;
    const said: string[] = [];
    const line = (n: number | undefined, one: string, many: string) => {
      if (n && n > 0) said.push(`${n} ${n === 1 ? one : many}`);
    };
    line(d.attachments, "attachment is left behind.", "attachments are left behind.");
    line(d.customFields, "custom field is left behind.", "custom fields are left behind.");
    line(d.starts, "start date is left behind.", "start dates are left behind.");
    line(
      d.dueComplete,
      "card ticks its due date as done; that tick is left behind.",
      "cards tick their due date as done; those ticks are left behind.",
    );
    line(
      d.actions,
      "entry of the board's history is not a comment and is left behind.",
      "entries of the board's history are not comments and are left behind.",
    );
    line(
      d.archivedLists,
      "archived list is left behind, with its cards.",
      "archived lists are left behind, with their cards.",
    );
    return said;
  },
  closing: ["Trello exports its last 1000 actions, so older comments are not in the file."],
};

/** A Trello board has lists and cards. Anything without both is another file. */
export function isTrello(file: Record<string, unknown>): boolean {
  return Array.isArray(file.lists) && Array.isArray(file.cards);
}

/* ------------------------------------------------------------------ */

type Raw = Record<string, unknown>;

function rows(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter((v): v is Raw => !!v && typeof v === "object") : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Trello's `pos`, as a number.
 *
 * It is a number in an export and a word — "top", "bottom" — only in an API
 * answer. Anything that is not a number sorts last rather than throwing the
 * card away: an order we cannot read is worth less than the card.
 */
function pos(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** Sorts by `pos` and keeps the file's own order where two are equal. */
function byPosition<T extends { pos: number }>(items: T[]): T[] {
  return items
    .map((item, at) => ({ item, at }))
    .sort(cmp)
    .map((both) => both.item);
}

function cmp<T extends { pos: number }>(a: { item: T; at: number }, b: { item: T; at: number }) {
  return a.item.pos - b.item.pos || a.at - b.at;
}

/**
 * Reads one Trello export, or says why it cannot.
 *
 * The limits are answered here and not in the route, because they are about
 * the file rather than about the request: the same sentence is owed to
 * whoever asks, and a test can ask without a server.
 */
export function readTrello(raw: string): SourceRead {
  const parsed = parseFile(raw);
  if (!parsed.ok) return parsed;
  /* A board has lists and cards. Anything without both is another file that
     happens to be JSON, and saying so beats making an empty board. */
  if (!isTrello(parsed.file)) {
    return { ok: false, said: "That file is not a Trello board: it has no lists and cards." };
  }
  return readTrelloFile(parsed.file);
}

/** Reads a parsed file that `isTrello` already knows. */
export function readTrelloFile(file: Raw): SourceRead {
  const cardRows = rows(file.cards);
  if (cardRows.length > MAX_CARDS) {
    return { ok: false, said: tooMany(cardRows.length) };
  }

  const allLists = rows(file.lists);
  const live = allLists.filter((l) => l.closed !== true);
  const lists = byPosition(
    live.map((l) => ({ id: text(l.id), name: text(l.name).trim(), pos: pos(l.pos) })),
  ).filter((l) => l.id && l.name);

  const known = new Set(lists.map((l) => l.id));
  const labels = rows(file.labels)
    .map((l) => ({ id: text(l.id), name: text(l.name).trim() }))
    /* Trello keeps a colour with no name as a label. It says nothing, so it
       is not an option; a card wearing one simply wears one label fewer. */
    .filter((l) => l.id && l.name);
  const members = rows(file.members)
    .map((m) => ({ id: text(m.id), name: text(m.fullName).trim() || text(m.username).trim() }))
    .filter((m) => m.id && m.name);

  const checklists = checklistsByCard(rows(file.checklists));
  const comments = commentsByCard(rows(file.actions));

  const cards: SourceCard[] = [];
  const dropped: TrelloDropped = {
    attachments: 0,
    customFields: rows(file.customFields).length,
    starts: 0,
    dueComplete: 0,
    actions: 0,
    archivedLists: allLists.length - live.length,
    homelessCards: 0,
  };

  for (const card of cardRows) {
    dropped.attachments += rows(card.attachments).length;
    if (text(card.start)) dropped.starts += 1;
    if (card.dueComplete === true) dropped.dueComplete += 1;

    const id = text(card.id);
    const listId = text(card.idList);
    if (!id || !known.has(listId)) {
      dropped.homelessCards += 1;
      continue;
    }
    cards.push({
      id,
      shortLink: text(card.shortLink) || text(card.shortUrl).split("/").pop() || "",
      name: text(card.name).trim(),
      desc: text(card.desc),
      listId,
      pos: pos(card.pos),
      link: null,
      due: text(card.due) || null,
      closed: card.closed === true,
      labelIds: ids(card.idLabels),
      memberIds: ids(card.idMembers),
      checklist: checklists.get(id) ?? [],
      comments: comments.get(id) ?? [],
    });
  }

  for (const action of rows(file.actions)) {
    if (text(action.type) !== "commentCard") dropped.actions += 1;
  }

  /* Lists in their order, then the cards inside each one in theirs. The whole
     import is written in this one order, so a board arrives looking like the
     board it left. */
  const order = new Map(lists.map((l, at) => [l.id, at]));
  const inOrder = cards
    .map((card, at) => ({ card, at }))
    .sort(
      (a, b) =>
        (order.get(a.card.listId ?? "") ?? 0) - (order.get(b.card.listId ?? "") ?? 0) ||
        a.card.pos - b.card.pos ||
        a.at - b.at,
    )
    .map((both) => both.card);

  return {
    ok: true,
    board: {
      source: TRELLO,
      name: text(file.name).trim() || "A Trello board",
      lists,
      labels,
      members,
      cards: inOrder,
      dropped,
      warning: null,
    },
  };
}

/**
 * The checklist of each card, as one flat list.
 *
 * A task has one checklist and a Trello card may have several, so two or more
 * of them read `List: item`. One on its own does not: a prefix that says
 * "Steps" on every line is noise on a card that only ever had one.
 */
function checklistsByCard(raw: Raw[]): Map<string, SourceChecklistItem[]> {
  const byCard = new Map<string, Raw[]>();
  for (const list of raw) {
    const cardId = text(list.idCard);
    if (!cardId) continue;
    byCard.set(cardId, [...(byCard.get(cardId) ?? []), list]);
  }

  const out = new Map<string, SourceChecklistItem[]>();
  for (const [cardId, lists] of byCard) {
    const ordered = byPosition(lists.map((l) => ({ raw: l, pos: pos(l.pos) })));
    const many = ordered.length > 1;
    const items: SourceChecklistItem[] = [];
    for (const { raw: list } of ordered) {
      const name = text(list.name).trim();
      for (const { raw: item } of byPosition(
        rows(list.checkItems).map((i) => ({ raw: i, pos: pos(i.pos) })),
      )) {
        const itemName = text(item.name).trim();
        if (!itemName) continue;
        items.push({
          text: many && name ? `${name}: ${itemName}` : itemName,
          done: text(item.state) === "complete",
        });
      }
    }
    if (items.length) out.set(cardId, items);
  }
  return out;
}

/** The comments of each card, oldest first. Everything else is not a comment. */
function commentsByCard(actions: Raw[]): Map<string, SourceComment[]> {
  const out = new Map<string, SourceComment[]>();
  for (const action of actions) {
    if (text(action.type) !== "commentCard") continue;
    const data = (action.data ?? {}) as Raw;
    const card = (data.card ?? {}) as Raw;
    const cardId = text(card.id);
    const body = text(data.text).trim();
    if (!cardId || !body) continue;
    const who = (action.memberCreator ?? {}) as Raw;
    out.set(cardId, [
      ...(out.get(cardId) ?? []),
      {
        author: text(who.fullName).trim() || text(who.username).trim() || "Somebody",
        text: body,
        at: text(action.date),
      },
    ]);
  }
  /* Oldest first, by the plain order of the bytes. These are ISO moments, not
     words, so no collator is wanted and none would agree with itself between
     the server and a browser anyway. */
  for (const [cardId, list] of out) {
    out.set(
      cardId,
      [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    );
  }
  return out;
}
