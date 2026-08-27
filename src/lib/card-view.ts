import { formatDate } from "./board";
import {
  CARD_BUILTIN_NAME,
  CARD_BUILTINS,
  CARD_PLACES,
  type CardBuiltin,
  type CardKind,
  type CardMode,
  type CardPlace,
  type CardRow,
  type CardView,
  type MemberDTO,
  type PropertyDTO,
  type PropertyType,
  type TaskDTO,
} from "./types";

/**
 * What a card carries, and how.
 *
 * Nothing here names Status, Priority or a due date. A row holds an id — a
 * property, or one of the five parts a task has of its own — and its kind says
 * which modes it offers and how the card draws it. Adding a property type
 * means adding a line to `KIND_OF_TYPE`, and nothing else.
 *
 * The words the card view is made of live in `types.ts`, beside the DTO that
 * carries them. What they mean lives here.
 */

/* ------------------------------------------------------------------ */
/* Kinds                                                               */
/* ------------------------------------------------------------------ */

/** Two property types that read the same way on a card share a kind. */
export const KIND_OF_TYPE: Record<PropertyType, CardKind> = {
  select: "select",
  multi_select: "select",
  person: "person",
  date: "date",
  checkbox: "flag",
  text: "text",
  number: "text",
};

export const KIND_OF_BUILTIN: Record<CardBuiltin, CardKind> = {
  _key: "id",
  _title: "title",
  _desc: "desc",
  _checklist: "checklist",
  _comments: "comments",
};

/**
 * The modes a kind offers, in the order the panel shows them. The first one is
 * what the row reads as until somebody says otherwise.
 */
export const MODES_FOR_KIND: Record<CardKind, { id: CardMode; label: string }[]> = {
  select: [
    { id: "both", label: "Both" },
    { id: "colour", label: "Colour" },
    { id: "text", label: "Text" },
  ],
  person: [
    { id: "avatar", label: "Avatar" },
    { id: "text", label: "Name" },
    { id: "both", label: "Both" },
  ],
  id: [
    { id: "text", label: "Plain" },
    { id: "boxed", label: "Boxed" },
  ],
  date: [
    { id: "text", label: "Plain" },
    { id: "boxed", label: "Boxed" },
  ],
  flag: [
    { id: "text", label: "Plain" },
    { id: "boxed", label: "Boxed" },
  ],
  text: [
    { id: "text", label: "Plain" },
    { id: "boxed", label: "Boxed" },
  ],
  desc: [
    { id: "two", label: "2 lines" },
    { id: "one", label: "1 line" },
  ],
  checklist: [
    { id: "bar", label: "Bar" },
    { id: "text", label: "Count" },
  ],
  comments: [{ id: "text", label: "Count" }],
  title: [{ id: "fixed", label: "Always the task title" }],
};

/**
 * The edge is a stripe of colour, so only a row that has colours of its own can
 * take it. Everything else would paint a stripe of nothing.
 */
export function canEdge(kind: CardKind): boolean {
  return kind === "select" || kind === "person";
}

export function isMode(kind: CardKind, mode: unknown): mode is CardMode {
  return MODES_FOR_KIND[kind].some((m) => m.id === mode);
}

function firstMode(kind: CardKind): CardMode {
  return MODES_FOR_KIND[kind][0].id;
}

/** The mode the edge forces: a stripe reads as one colour and nothing else. */
function edgeMode(kind: CardKind): CardMode {
  return kind === "person" ? "avatar" : "colour";
}

/**
 * Where a row sits when nobody has said — a property added long after somebody
 * arranged the card. The footer is the quiet end, which is where a newcomer
 * belongs: it joins the card, and it joins it without shouting.
 */
export function fallbackRow(kind: CardKind): CardRow {
  switch (kind) {
    case "id":
      return { place: "headerL", mode: "text" };
    case "title":
      return { place: "title", mode: "fixed" };
    case "desc":
      return { place: "off", mode: "two" };
    case "checklist":
      return { place: "footerL", mode: "bar" };
    case "comments":
      return { place: "footerL", mode: "text" };
    case "person":
      return { place: "headerR", mode: "avatar" };
    default:
      return { place: "footerL", mode: firstMode(kind) };
  }
}

/* ------------------------------------------------------------------ */
/* The default                                                         */
/* ------------------------------------------------------------------ */

/**
 * The card a project has before anybody arranges one: the card this board drew
 * for its first six versions. The lead colour and the key open the header, the
 * people and the labels close it, and everything else lines up in the footer.
 *
 * It does not go through `fallbackRow`, and it should not. That answers "a
 * property arrived, where does it go"; this answers "nobody has ever said", and
 * the honest answer to that is the card people already know.
 */
export function defaultCardView(properties: PropertyDTO[], groupById: string | null): CardView {
  const rows: Record<string, CardRow> = {
    _key: { place: "headerL", mode: "text" },
    _title: { place: "title", mode: "fixed" },
    _desc: { place: "off", mode: "two" },
    _checklist: { place: "footerL", mode: "bar" },
    _comments: { place: "footerL", mode: "text" },
  };

  /* The small square of colour a card has always opened with: the first select
     that is not the columns of the default view. */
  const lead = properties.find(
    (p) => p.type === "select" && p.id !== groupById && p.config.showOnCard !== false,
  );

  const rest: string[] = [];
  for (const property of properties) {
    const kind = KIND_OF_TYPE[property.type];
    if (property.id === lead?.id) {
      rows[property.id] = { place: "headerL", mode: "colour" };
      continue;
    }
    rest.push(property.id);
    /* The columns already say it, so the card never did. */
    if (property.id === groupById || property.config.showOnCard === false) {
      rows[property.id] = { place: "off", mode: firstMode(kind) };
    } else if (property.type === "multi_select") {
      rows[property.id] = { place: "headerR", mode: "colour" };
    } else {
      rows[property.id] = fallbackRow(kind);
    }
  }

  const order = [
    ...(lead ? [lead.id] : []),
    "_key",
    "_title",
    "_desc",
    ...rest,
    "_checklist",
    "_comments",
  ];

  return { order, rows };
}

/* ------------------------------------------------------------------ */
/* Reading one back                                                    */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A saved card view, made safe to draw.
 *
 * Nothing rewrites the card view when a property is deleted, exactly as
 * nothing rewrites a filter: a cleanup pass would have to run in four places
 * and would still lose a race. So a saved row can name a property that is gone,
 * and this throws those away every time the card view is read — on the server
 * in `loadBoard`, and again on the write. A row nobody can see must never keep
 * a place on the card.
 *
 * It also settles what a hand-written PATCH cannot be trusted to: the title
 * never moves, only one row holds the edge, and a mode a kind does not offer
 * becomes the one it does.
 */
export function readCardView(
  saved: unknown,
  properties: PropertyDTO[],
  groupById: string | null,
): CardView {
  if (!isRecord(saved) || !Array.isArray(saved.order) || !isRecord(saved.rows)) {
    return defaultCardView(properties, groupById);
  }

  const kinds = new Map<string, CardKind>();
  for (const id of CARD_BUILTINS) kinds.set(id, KIND_OF_BUILTIN[id]);
  for (const property of properties) kinds.set(property.id, KIND_OF_TYPE[property.type]);

  const order: string[] = [];
  for (const id of saved.order) {
    if (typeof id === "string" && kinds.has(id) && !order.includes(id)) order.push(id);
  }
  for (const id of kinds.keys()) if (!order.includes(id)) order.push(id);

  const savedRows = saved.rows as Record<string, unknown>;
  const rows: Record<string, CardRow> = {};
  let edgeTaken = false;

  for (const id of order) {
    const kind = kinds.get(id)!;
    const fallback = fallbackRow(kind);

    if (kind === "title") {
      rows[id] = { place: "title", mode: "fixed" };
      continue;
    }

    const row = savedRows[id];
    let place: CardPlace = fallback.place;
    let mode: CardMode = fallback.mode;

    if (isRecord(row)) {
      const wanted = row.place;
      if (
        typeof wanted === "string" &&
        (CARD_PLACES as readonly string[]).includes(wanted) &&
        wanted !== "title" &&
        (wanted !== "edge" || (canEdge(kind) && !edgeTaken))
      ) {
        place = wanted as CardPlace;
      }
      if (typeof row.mode === "string" && isMode(kind, row.mode)) mode = row.mode;
    }

    if (place === "edge") {
      edgeTaken = true;
      mode = edgeMode(kind);
    }
    if (!isMode(kind, mode)) mode = firstMode(kind);
    rows[id] = { place, mode };
  }

  return { order, rows };
}

/**
 * The card view after one click, ready to save. The panel writes through this
 * so that the rules of `readCardView` hold before the board redraws, not after
 * the server answers.
 */
export function setCardPlace(view: CardView, id: string, place: CardPlace): CardView {
  const rows = { ...view.rows };
  const mine = rows[id];
  if (!mine) return view;

  if (place === "edge") {
    /* The stripe is one property wide. Taking it takes the other one off. */
    for (const [other, row] of Object.entries(rows)) {
      if (other !== id && row.place === "edge") rows[other] = { ...row, place: "off" };
    }
  }
  rows[id] = { ...mine, place };
  return { ...view, rows };
}

export function setCardMode(view: CardView, id: string, mode: CardMode): CardView {
  const rows = { ...view.rows };
  const mine = rows[id];
  if (!mine) return view;
  /* The edge is a stripe of colour. Asking for words moves the row off it. */
  const place =
    mine.place === "edge" && mode !== "colour" && mode !== "avatar" ? "headerL" : mine.place;
  rows[id] = { place, mode };
  return { ...view, rows };
}

/** Moves one row up or down the list. Rows sharing a place sit in this order. */
export function moveCardRow(view: CardView, id: string, by: -1 | 1): CardView {
  const order = [...view.order];
  const at = order.indexOf(id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= order.length) return view;
  order.splice(to, 0, order.splice(at, 1)[0]);
  return { ...view, order };
}

/* ------------------------------------------------------------------ */
/* Rows, joined to the properties behind them                          */
/* ------------------------------------------------------------------ */

export type CardItem = {
  id: string;
  name: string;
  kind: CardKind;
  place: CardPlace;
  mode: CardMode;
  /** The property behind the row, or null for a part the task has of its own. */
  property: PropertyDTO | null;
  /** The colour that stands for the row in the settings list. */
  color: string;
  builtin: boolean;
  /** The title cannot move and cannot come off. */
  fixed: boolean;
};

const BUILTIN_COLOR = "#8b8f98";

/** Every row of the card view, in order, with the property behind it. */
export function cardItems(view: CardView, properties: PropertyDTO[]): CardItem[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const items: CardItem[] = [];

  for (const id of view.order) {
    const row = view.rows[id];
    if (!row) continue;
    const property = byId.get(id) ?? null;

    if (property) {
      items.push({
        id,
        name: property.name,
        kind: KIND_OF_TYPE[property.type],
        place: row.place,
        mode: row.mode,
        property,
        color: property.options[0]?.color ?? BUILTIN_COLOR,
        builtin: false,
        fixed: false,
      });
      continue;
    }

    if (!(CARD_BUILTINS as readonly string[]).includes(id)) continue;
    const builtin = id as CardBuiltin;
    items.push({
      id,
      name: CARD_BUILTIN_NAME[builtin],
      kind: KIND_OF_BUILTIN[builtin],
      place: row.place,
      mode: row.mode,
      property: null,
      color: builtin === "_title" ? "#cdd2d9" : BUILTIN_COLOR,
      builtin: true,
      fixed: builtin === "_title",
    });
  }

  return items;
}

/**
 * The rows again as the object that is stored. A click says what the whole card
 * view becomes, so the panel turns what it is showing back into one of these
 * and writes the change onto it.
 */
export function viewOf(items: CardItem[]): CardView {
  return {
    order: items.map((i) => i.id),
    rows: Object.fromEntries(items.map((i) => [i.id, { place: i.place, mode: i.mode }])),
  };
}

/* ------------------------------------------------------------------ */
/* Drawing a card                                                      */
/* ------------------------------------------------------------------ */

/**
 * One small part of a card. Every place holds a list of these, and the card
 * draws them the same way wherever they landed.
 */
export type CardChip = {
  key: string;
  /** The tooltip: the row this came from, and what the task holds for it. */
  tip: string;
  swatch: { color: string; round: boolean } | null;
  person: MemberDTO | null;
  text: string | null;
  /** A hairline box around it. */
  boxed: boolean;
  /** Monospace, like the key and the dates. Off for words a person wrote. */
  mono: boolean;
  /** The checklist bar. */
  bar: { done: number; total: number } | null;
  /** The speech bubble that goes in front of a comment count. */
  bubble: boolean;
};

export type CardSlots = {
  /** The colour of the stripe down the left, or null. */
  edge: string | null;
  headerL: CardChip[];
  headerR: CardChip[];
  /** The description, when it sits in the body. */
  body: { text: string; lines: number } | null;
  bodyChips: CardChip[];
  footerL: CardChip[];
  footerR: CardChip[];
};

function chip(item: CardItem, key: string, value: string, extra: Partial<CardChip>): CardChip {
  return {
    key,
    tip: `${item.name} · ${value}`,
    swatch: null,
    person: null,
    text: null,
    boxed: false,
    mono: true,
    bar: null,
    bubble: false,
    ...extra,
  };
}

/** What a task holds for one row, as the parts the card draws. Empty is empty. */
function chipsFor(item: CardItem, task: TaskDTO, members: MemberDTO[]): CardChip[] {
  const boxed = item.mode === "boxed";

  switch (item.kind) {
    case "id":
      return [chip(item, `${item.id}-${task.id}`, task.key, { text: task.key, boxed })];

    case "desc": {
      const text = task.description.trim();
      if (!text) return [];
      return [chip(item, `${item.id}-${task.id}`, text, { text, mono: false })];
    }

    case "checklist": {
      if (task.checklistTotal === 0) return [];
      const count = `${task.checklistDone}/${task.checklistTotal}`;
      return [
        chip(item, `${item.id}-${task.id}`, count, {
          text: count,
          bar:
            item.mode === "bar" ? { done: task.checklistDone, total: task.checklistTotal } : null,
        }),
      ];
    }

    case "comments": {
      if (task.commentCount === 0) return [];
      const count = String(task.commentCount);
      return [chip(item, `${item.id}-${task.id}`, count, { text: count, bubble: true })];
    }

    default:
      break;
  }

  const property = item.property;
  if (!property) return [];
  const value = task.values[property.id];
  if (value === null || value === undefined || value === "") return [];

  switch (item.kind) {
    case "select": {
      const ids = Array.isArray(value) ? value.map(String) : [String(value)];
      const chips: CardChip[] = [];
      for (const id of ids) {
        const option = property.options.find((o) => o.id === id);
        if (!option) continue;
        chips.push(
          chip(item, `${item.id}-${task.id}-${option.id}`, option.name, {
            swatch:
              item.mode === "text" ? null : { color: option.color, round: item.mode === "both" },
            text: item.mode === "colour" ? null : option.name,
            boxed: item.mode !== "colour",
          }),
        );
      }
      return chips;
    }

    case "person": {
      const member = members.find((m) => m.id === value);
      if (!member) return [];
      return [
        chip(item, `${item.id}-${task.id}`, member.name, {
          person: item.mode === "text" ? null : member,
          text: item.mode === "avatar" ? null : member.name,
          boxed: item.mode === "both",
        }),
      ];
    }

    case "date": {
      const text = formatDate(String(value));
      return [chip(item, `${item.id}-${task.id}`, text, { text, boxed })];
    }

    case "flag": {
      if (value !== true) return [];
      return [chip(item, `${item.id}-${task.id}`, item.name, { text: item.name, boxed })];
    }

    default: {
      const text = String(value).slice(0, 40);
      return [chip(item, `${item.id}-${task.id}`, text, { text, boxed })];
    }
  }
}

/**
 * A task, laid out the way the card view asks for. A card only draws what a
 * task actually holds, so a task with no due date has a shorter footer than the
 * one beside it and neither leaves a gap.
 */
export function buildCard(items: CardItem[], task: TaskDTO, members: MemberDTO[]): CardSlots {
  const slots: CardSlots = {
    edge: null,
    headerL: [],
    headerR: [],
    body: null,
    bodyChips: [],
    footerL: [],
    footerR: [],
  };

  for (const item of items) {
    if (item.place === "off" || item.place === "title") continue;

    if (item.place === "edge") {
      const [first] = chipsFor(item, task, members);
      slots.edge = first?.swatch?.color ?? first?.person?.color ?? null;
      continue;
    }

    if (item.kind === "desc" && item.place === "body") {
      const text = task.description.trim();
      if (text) slots.body = { text, lines: item.mode === "one" ? 1 : 2 };
      continue;
    }

    const chips = chipsFor(item, task, members);
    if (!chips.length) continue;
    if (item.place === "headerL") slots.headerL.push(...chips);
    else if (item.place === "headerR") slots.headerR.push(...chips);
    else if (item.place === "footerL") slots.footerL.push(...chips);
    else if (item.place === "footerR") slots.footerR.push(...chips);
    else slots.bodyChips.push(...chips);
  }

  return slots;
}

/**
 * The colour the panel takes: the stripe the card draws down its left side, so
 * a card and the panel it opens are the same colour. It is the card view that
 * decides, and this asks it the same way the card does rather than working a
 * colour out a second time — a panel that names its own property drifts from
 * the board the first time somebody moves the edge.
 *
 * A board with no stripe falls back to the first colour the card leads with. A
 * row that reads as words carries none, and neither does an empty value, which
 * is why the answer is a colour and not a property.
 */
export function cardAccent(items: CardItem[], task: TaskDTO, members: MemberDTO[]): string | null {
  const colourOf = (item: CardItem): string | null => {
    const [first] = chipsFor(item, task, members);
    return first?.swatch?.color ?? first?.person?.color ?? null;
  };

  const edge = items.find((i) => i.place === "edge");
  if (edge) return colourOf(edge);

  for (const item of items) {
    if (item.place === "off" || item.place === "title") continue;
    const colour = colourOf(item);
    if (colour) return colour;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* A card to look at while arranging one                               */
/* ------------------------------------------------------------------ */

/*
 * The stand-in card is drawn on the server and again in the browser, so nothing
 * in it may come from the clock: the two would disagree across a midnight or a
 * timezone, and React would throw the server tree away. A written-out date it
 * is, then.
 */
const SAMPLE_DATE = "2026-08-29";
const SAMPLE_TIME = "2026-08-27T09:00:00.000Z";

/**
 * A stand-in task for the settings preview, used only while a project has no
 * tasks of its own. It fills in one value for every property, so every row a
 * person clicks has something to show.
 */
export function sampleTask(properties: PropertyDTO[], members: MemberDTO[], key: string): TaskDTO {
  const values: TaskDTO["values"] = {};
  for (const property of properties) {
    switch (property.type) {
      case "select":
        if (property.options[0]) values[property.id] = property.options[0].id;
        break;
      case "multi_select":
        values[property.id] = property.options.slice(0, 2).map((o) => o.id);
        break;
      case "person":
        if (members[0]) values[property.id] = members[0].id;
        break;
      case "date":
        values[property.id] = SAMPLE_DATE;
        break;
      case "number":
        values[property.id] = 3;
        break;
      case "checkbox":
        values[property.id] = true;
        break;
      default:
        values[property.id] = "Some text";
    }
  }

  return {
    id: "sample",
    number: 1,
    key: `${key}-1`,
    title: "A card of this project, drawn the way the rows say",
    description: "The description sits in the body. Two lines of it, or one, or none at all.",
    position: "V",
    createdAt: SAMPLE_TIME,
    updatedAt: SAMPLE_TIME,
    values,
    checklistTotal: 4,
    checklistDone: 3,
    commentCount: 2,
  };
}

/**
 * The tasks the preview draws: the ones that carry the most, because a card
 * that holds nothing shows nothing and teaches nothing.
 */
export function previewTasks(
  tasks: TaskDTO[],
  properties: PropertyDTO[],
  members: MemberDTO[],
  key: string,
  count = 3,
): TaskDTO[] {
  if (!tasks.length) return [sampleTask(properties, members, key)];
  const weight = (task: TaskDTO) =>
    Object.values(task.values).filter((v) =>
      Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "",
    ).length;
  return [...tasks].sort((a, b) => weight(b) - weight(a)).slice(0, count);
}
