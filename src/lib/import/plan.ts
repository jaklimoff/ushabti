import type { ImportPreviewDTO, ImportRowDTO } from "@/lib/types";
import { SOURCE, type Dropped, type SourceBoard, type SourceCard } from "./trello";

/**
 * What an import will do, worked out before anything is written.
 *
 * The preview draws this and the write obeys it, so the page cannot promise
 * one thing and the database do another: both call `planImport` with the same
 * file and the same answer from the owner. It reads no database and no clock
 * — the project's shape is an argument — so the whole mapping is a unit test.
 *
 * A list becomes an option, never a property. Where a name matches, the
 * import writes into what the project already has; where it does not, it adds
 * one option beside them. Nothing on a task is hardcoded here either: the
 * three properties below are found by name and made only when the project has
 * none of that name.
 */

/** The properties an import writes into, by name. A missing one is made. */
export const LABELS_PROPERTY = "Labels";
export const DUE_PROPERTY = "Due";
export const ASSIGNEE_PROPERTY = "Assignee";

/** How long a title and a body may be, as every other route holds them. */
const MAX_TITLE = 400;
const MAX_BODY = 20_000;

export type ShapeProperty = {
  id: string;
  name: string;
  type: string;
  options: { id: string; name: string }[];
};

/** The board as it is today, as far as an import has to know it. */
export type ProjectShape = {
  properties: ShapeProperty[];
  members: { id: string; name: string }[];
  /** The property the main view makes its columns from, or null. */
  groupPropertyId: string | null;
  /** `sourceId` of every card this project took from an earlier import. */
  already: Set<string>;
};

/** What the owner changed on the preview. Everything here has a proposal. */
export type MappingAsk = {
  /** Which property the lists become options of. */
  groupPropertyId?: string | null;
  /** Source list id → an option of that property, or null for a new one. */
  lists?: Record<string, string | null>;
  /** Source label id → an option of Labels, or null for a new one. */
  labels?: Record<string, string | null>;
  /** Bring the archived cards in, archived. Off unless somebody says so. */
  archived?: boolean;
};

/** A property this import writes into. `id` is null while it is still to be made. */
export type PlanProperty = { id: string | null; name: string; making: boolean };

/** One list or one label, and the option it lands on. */
export type PlanOption = {
  sourceId: string;
  name: string;
  /** How many cards of this import wear it. */
  cards: number;
  /** The option it goes to, or null when the import adds one. */
  optionId: string | null;
  /** What that option is called, which is the name when it is new. */
  optionName: string;
  making: boolean;
};

export type PlanTask = {
  sourceId: string;
  /** How to find the card it came from again. Trello's short code. */
  sourceKey: string;
  title: string;
  description: string;
  listId: string;
  labelIds: string[];
  /** `YYYY-MM-DD` in UTC, or null. */
  due: string | null;
  /** A member of this project, matched by name, or null. */
  assigneeId: string | null;
  archived: boolean;
  checklist: { text: string; done: boolean }[];
  comments: { body: string }[];
};

export type Plan = {
  source: string;
  board: string;
  group: PlanProperty;
  labelsProperty: PlanProperty;
  dueProperty: PlanProperty;
  assigneeProperty: PlanProperty;
  lists: PlanOption[];
  labels: PlanOption[];
  /** The cards that become tasks, in the order they will be written. */
  tasks: PlanTask[];
  /** Cards this board took on an earlier import and will not take again. */
  already: number;
  archived: { inFile: number; coming: boolean };
  /** Trello names, split by whether this board has somebody of that name. */
  people: { matched: string[]; named: string[] };
  /** Cards that carried more than one member. Only the first one comes. */
  extraMembers: number;
  dropped: Dropped;
};

/* ------------------------------------------------------------------ */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The property of this name and type, or null. A name matches either case. */
function propertyNamed(shape: ProjectShape, name: string, type: string): ShapeProperty | null {
  return shape.properties.find((p) => p.type === type && same(p.name, name)) ?? null;
}

function found(property: ShapeProperty | null, name: string): PlanProperty {
  return property
    ? { id: property.id, name: property.name, making: false }
    : { id: null, name, making: true };
}

/**
 * The property the columns come from.
 *
 * The owner's pick wins, then the main view's grouping property, then any
 * select the board has. A board with no select at all gets one called Status
 * — the same word a new project starts with, and an ordinary property the
 * owner can rename the moment the import is over.
 */
function groupProperty(shape: ProjectShape, ask: MappingAsk): PlanProperty {
  const selects = shape.properties.filter((p) => p.type === "select");
  const asked = ask.groupPropertyId
    ? (selects.find((p) => p.id === ask.groupPropertyId) ?? null)
    : null;
  const chosen = asked ?? selects.find((p) => p.id === shape.groupPropertyId) ?? selects[0] ?? null;
  return found(chosen, "Status");
}

/** The option of this property that already carries this name, or null. */
function optionNamed(property: PlanProperty, shape: ProjectShape, name: string) {
  if (!property.id) return null;
  const options = shape.properties.find((p) => p.id === property.id)?.options ?? [];
  return options.find((o) => same(o.name, name)) ?? null;
}

/**
 * Where one name lands: an option the owner named, the one that matches, or
 * a new one.
 *
 * An id the owner sends that is not an option of this property is not an
 * answer, so it falls back to the proposal rather than being refused: the
 * property may have changed under the preview, and an import that stops
 * halfway on a stale id helps nobody.
 */
function landing(
  property: PlanProperty,
  shape: ProjectShape,
  name: string,
  asked: Record<string, string | null> | undefined,
  sourceId: string,
): { optionId: string | null; optionName: string } {
  const options = property.id
    ? (shape.properties.find((p) => p.id === property.id)?.options ?? [])
    : [];
  const pick = asked?.[sourceId];
  if (pick === null) return { optionId: null, optionName: name };
  if (typeof pick === "string") {
    const option = options.find((o) => o.id === pick);
    if (option) return { optionId: option.id, optionName: option.name };
  }
  const match = optionNamed(property, shape, name);
  return match
    ? { optionId: match.id, optionName: match.name }
    : { optionId: null, optionName: name };
}

/** The date part of a Trello moment, in UTC, or null. */
export function dueDate(raw: string | null): string | null {
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 10);
}

/** One Trello comment, written as the importer with its author named. */
export function commentBody(author: string, body: string): string {
  return `**${author}** wrote on Trello:\n\n${body}`.slice(0, MAX_BODY);
}

/** A card with nothing in the name box is still a card. */
function titleOf(card: SourceCard): string {
  return (card.name || "Untitled card").slice(0, MAX_TITLE);
}

/**
 * Works out what the import will do.
 *
 * Every card of the file is looked at, so the counts on the preview are the
 * counts of the write. A card this board already holds is left out here and
 * nowhere else: that is the whole of "nothing twice".
 */
export function planImport(board: SourceBoard, shape: ProjectShape, ask: MappingAsk = {}): Plan {
  const group = groupProperty(shape, ask);
  const labelsProperty = found(
    propertyNamed(shape, LABELS_PROPERTY, "multi_select"),
    LABELS_PROPERTY,
  );
  const dueProperty = found(propertyNamed(shape, DUE_PROPERTY, "date"), DUE_PROPERTY);
  const assigneeProperty = found(
    propertyNamed(shape, ASSIGNEE_PROPERTY, "person"),
    ASSIGNEE_PROPERTY,
  );

  const archived = ask.archived === true;
  const coming = board.cards.filter((c) => (archived || !c.closed) && !shape.already.has(c.id));

  const byName = new Map(shape.members.map((m) => [m.name.trim().toLowerCase(), m.id]));
  const memberName = new Map(board.members.map((m) => [m.id, m.name]));
  const matched = new Set<string>();
  const named = new Set<string>();
  let extraMembers = 0;

  const tasks: PlanTask[] = coming.map((card) => {
    const first = card.memberIds[0];
    if (card.memberIds.length > 1) extraMembers += card.memberIds.length - 1;
    const who = first ? (memberName.get(first) ?? null) : null;
    const assigneeId = who ? (byName.get(who.trim().toLowerCase()) ?? null) : null;
    if (who) (assigneeId ? matched : named).add(who);

    /* A person we cannot match is not made and not lost: their name goes on
       the last line of the description, where a reader will find it. */
    const description = (
      who && !assigneeId ? `${card.desc}\n\nAssigned on Trello to ${who}.`.trim() : card.desc
    ).slice(0, MAX_BODY);

    return {
      sourceId: card.id,
      sourceKey: card.shortLink,
      title: titleOf(card),
      description,
      listId: card.listId,
      labelIds: card.labelIds,
      due: dueDate(card.due),
      assigneeId,
      archived: card.closed,
      checklist: card.checklist,
      comments: card.comments.map((c) => ({ body: commentBody(c.author, c.text) })),
    };
  });

  const count = (of: (task: PlanTask) => boolean) => tasks.filter(of).length;

  const row = (
    property: PlanProperty,
    asked: Record<string, string | null> | undefined,
    of: { id: string; name: string },
    cards: number,
  ): PlanOption => {
    const at = landing(property, shape, of.name, asked, of.id);
    return { sourceId: of.id, name: of.name, cards, ...at, making: at.optionId === null };
  };

  const lists = board.lists.map((list) =>
    row(
      group,
      ask.lists,
      list,
      count((task) => task.listId === list.id),
    ),
  );
  const labels = board.labels.map((label) =>
    row(
      labelsProperty,
      ask.labels,
      label,
      count((task) => task.labelIds.includes(label.id)),
    ),
  );

  return {
    source: SOURCE,
    board: board.name,
    group,
    labelsProperty,
    dueProperty,
    assigneeProperty,
    lists,
    labels,
    tasks,
    already: board.cards.filter((c) => shape.already.has(c.id)).length,
    archived: { inFile: board.cards.filter((c) => c.closed).length, coming: archived },
    people: { matched: [...matched], named: [...named] },
    extraMembers,
    dropped: board.dropped,
  };
}

/**
 * What will not come, in sentences.
 *
 * The preview says it out loud rather than listing every key Trello has: a
 * count of a thing somebody will miss is worth reading, and a zero is not, so
 * nothing that is not in the file gets a line.
 */
export function droppedSaid(plan: Plan): string[] {
  const d = plan.dropped;
  const said: string[] = [];
  const line = (n: number, one: string, many: string) => {
    if (n > 0) said.push(`${n} ${n === 1 ? one : many}`);
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
  line(
    plan.labels.filter((label) => label.cards === 0).length,
    "label is on no card and does not come.",
    "labels are on no card and do not come.",
  );
  line(
    plan.extraMembers,
    "card names a second person; only the first one comes.",
    "cards name a second person; only the first one comes.",
  );
  if (!plan.archived.coming && plan.archived.inFile > 0) {
    said.push(
      `${plan.archived.inFile} archived ${plan.archived.inFile === 1 ? "card stays" : "cards stay"} behind. Turn the switch on to bring ${plan.archived.inFile === 1 ? "it" : "them"} in, archived.`,
    );
  }
  said.push("Trello exports its last 1000 actions, so older comments are not in the file.");
  return said;
}

/**
 * The plan as the preview page reads it: counts, and never the cards.
 *
 * The browser already holds the file, so sending two thousand tasks back
 * would be the whole import twice. It sends the same answer to the import
 * route instead, and the server plans it again from the file.
 */
export function previewOf(plan: Plan): ImportPreviewDTO {
  const row = (option: PlanOption): ImportRowDTO => ({
    sourceId: option.sourceId,
    name: option.name,
    cards: option.cards,
    optionId: option.optionId,
    optionName: option.optionName,
    making: option.making,
  });
  return {
    source: plan.source,
    board: plan.board,
    group: { propertyId: plan.group.id, name: plan.group.name, making: plan.group.making },
    properties: [plan.labelsProperty, plan.dueProperty, plan.assigneeProperty].map((p) => ({
      name: p.name,
      making: p.making,
    })),
    lists: plan.lists.map(row),
    /* Only the labels a card wears. The write makes an option for those and
       for no others, so the preview must not offer a chooser for the rest. */
    labels: plan.labels.filter((label) => label.cards > 0).map(row),
    tasks: { coming: plan.tasks.length, already: plan.already },
    archived: plan.archived,
    people: plan.people,
    dropped: droppedSaid(plan),
  };
}
