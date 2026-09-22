/**
 * A Trello export, read into the few things a board can use.
 *
 * Trello's export is one JSON file and it carries far more than a task board
 * needs. This module is the whole of what we understand of it: everything
 * below reads `SourceBoard` and never the file again, so adding a second
 * source later is another reader and not a second import.
 *
 * Nothing here touches the database or the clock, so the limits and the
 * mapping can both be asked without a server.
 */

/** How large a file may be. A board this size is a board, not a backup. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** How many cards one import may carry. */
export const MAX_CARDS = 2000;

/** The one sentence a file that is too large is refused with, wherever it is
 * read: the route answers it from the header and this module from the bytes. */
export const TOO_LARGE = "That file is larger than 5 MB. An import takes 5 MB at a time.";

/** The word that names where a task came from. There is one of them. */
export const SOURCE = "trello";

export type SourceList = {
  id: string;
  name: string;
  /** Trello's own order. A number in an export, and lists are read by it. */
  pos: number;
};

export type SourceLabel = { id: string; name: string };

/** A person on the Trello board. Trello carries no email, only a name. */
export type SourceMember = { id: string; name: string };

export type SourceChecklistItem = { text: string; done: boolean };

export type SourceComment = { author: string; text: string; at: string };

export type SourceCard = {
  id: string;
  /** Trello's short code for the card, which is the tail of its URL. */
  shortLink: string;
  name: string;
  desc: string;
  listId: string;
  pos: number;
  /** The moment Trello holds, or null. The date part of it becomes Due. */
  due: string | null;
  /** Archived on Trello. */
  closed: boolean;
  labelIds: string[];
  memberIds: string[];
  checklist: SourceChecklistItem[];
  comments: SourceComment[];
};

/**
 * What the file holds that a task board cannot take.
 *
 * It is counted rather than ignored, because the preview says it out loud:
 * somebody who is about to move a year of work deserves to read what will not
 * come with it before they press the button.
 */
export type Dropped = {
  attachments: number;
  customFields: number;
  starts: number;
  dueComplete: number;
  actions: number;
  archivedLists: number;
  /** Cards of an archived list, and cards whose list is not in the file. */
  homelessCards: number;
};

export type SourceBoard = {
  name: string;
  lists: SourceList[];
  labels: SourceLabel[];
  members: SourceMember[];
  /** Every card of a live list, lists in `pos` order and cards inside them. */
  cards: SourceCard[];
  dropped: Dropped;
};

export type TrelloRead = { ok: true; board: SourceBoard } | { ok: false; said: string };

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
 * Reads one export, or says why it cannot.
 *
 * The two limits are answered here and not in the route, because they are
 * about the file rather than about the request: the same sentence is owed to
 * whoever asks, and a test can ask without a server.
 */
export function readTrello(raw: string): TrelloRead {
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > MAX_FILE_BYTES) return { ok: false, said: TOO_LARGE };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, said: "That file is not JSON. Export the board again as JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, said: "That file is not a Trello board." };
  }

  const file = parsed as Raw;
  /* A board has lists and cards. Anything without both is another file that
     happens to be JSON, and saying so beats making an empty board. */
  if (!Array.isArray(file.lists) || !Array.isArray(file.cards)) {
    return { ok: false, said: "That file is not a Trello board: it has no lists and cards." };
  }

  const cardRows = rows(file.cards);
  if (cardRows.length > MAX_CARDS) {
    return {
      ok: false,
      said: `That export has ${cardRows.length} cards. An import takes ${MAX_CARDS} at a time.`,
    };
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
  const dropped: Dropped = {
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
        (order.get(a.card.listId) ?? 0) - (order.get(b.card.listId) ?? 0) ||
        a.card.pos - b.card.pos ||
        a.at - b.at,
    )
    .map((both) => both.card);

  return {
    ok: true,
    board: {
      name: text(file.name).trim() || "A Trello board",
      lists,
      labels,
      members,
      cards: inOrder,
      dropped,
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
