export const PROPERTY_TYPES = [
  "select",
  "multi_select",
  "person",
  "text",
  "number",
  "date",
  "checkbox",
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  select: "Select",
  multi_select: "Multi-select",
  person: "Person",
  text: "Text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
};

export const PROPERTY_TYPE_HINT: Record<PropertyType, string> = {
  select: "One option from a list you define. Can group the board.",
  multi_select: "Any number of options from a list you define.",
  person: "One member of the project. Can group the board.",
  text: "Free text.",
  number: "A number.",
  date: "A calendar date.",
  checkbox: "On or off.",
};

/** Only these types can become the columns of a board. */
export const GROUPABLE_TYPES: PropertyType[] = ["select", "person", "checkbox"];

export type PropertyConfig = {
  /**
   * Where a property sits on a card is the card view's business now. This is
   * what older projects wrote before that page existed, and it still seeds the
   * card view a project falls back to. Nothing writes it any more.
   */
  showOnCard?: boolean;
};

export type PropertyOptionDTO = {
  id: string;
  name: string;
  color: string;
  position: string;
};

export type PropertyDTO = {
  id: string;
  name: string;
  type: PropertyType;
  position: string;
  config: PropertyConfig;
  options: PropertyOptionDTO[];
};

export type MemberDTO = {
  id: string;
  name: string;
  /** Null for an agent. Only a person has an email address. */
  email: string | null;
  color: string;
  role: string;
  kind: "human" | "agent";
};

export type TaskValue = string | string[] | number | boolean | null;

export type TaskDTO = {
  id: string;
  number: number;
  key: string;
  title: string;
  description: string;
  position: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, TaskValue>;
  checklistTotal: number;
  checklistDone: number;
  commentCount: number;
};

/* ------------------------------------------------------------------ */
/* The card view                                                       */
/* ------------------------------------------------------------------ */

/**
 * The three parts of a task that behave like properties on a card without
 * being any: its key, its title and its description. The checklist and the
 * comment count join them, because a card draws those too and somebody has to
 * be able to take them off. Nothing here is a field on a task — the words are
 * fixed, the values come from the task row the board already has.
 */
export const CARD_BUILTINS = ["_key", "_title", "_desc", "_checklist", "_comments"] as const;

export type CardBuiltin = (typeof CARD_BUILTINS)[number];

export const CARD_BUILTIN_NAME: Record<CardBuiltin, string> = {
  _key: "Task ID",
  _title: "Title",
  _desc: "Description",
  _checklist: "Checklist",
  _comments: "Comments",
};

/**
 * Where a row sits on the card. A card is a header row, a title, a body and a
 * footer, and the two ends of the header and the footer are separate places,
 * so a row can sit left or right. `edge` is the stripe down the left side,
 * `title` belongs to the title alone, and `off` means the card never draws it.
 */
export const CARD_PLACES = [
  "edge",
  "headerL",
  "headerR",
  "body",
  "footerL",
  "footerR",
  "title",
  "off",
] as const;

export type CardPlace = (typeof CARD_PLACES)[number];

export const CARD_PLACE_LABEL: Record<CardPlace, string> = {
  edge: "Edge stripe",
  headerL: "Header left",
  headerR: "Header right",
  body: "Body",
  footerL: "Footer left",
  footerR: "Footer right",
  title: "Title row",
  off: "Not shown",
};

/**
 * How a row reads. Which of these a row may use comes from its kind, not from
 * its type: two property types that read the same way share a kind.
 */
export const CARD_MODES = [
  /* select, multi_select */
  "colour",
  "both",
  "fill",
  /* person */
  "avatar",
  /* anything with words */
  "text",
  "boxed",
  /* the description */
  "one",
  "two",
  /* the checklist */
  "bar",
  /* the title */
  "fixed",
] as const;

export type CardMode = (typeof CARD_MODES)[number];

/**
 * The kinds a row can be. A property type maps onto one of these, and the kind
 * decides which modes the row offers and how the card draws it. Adding a
 * property type means mapping it to a kind, and nothing else.
 */
export const CARD_KINDS = [
  "id",
  "title",
  "desc",
  "checklist",
  "comments",
  "select",
  "person",
  "date",
  "flag",
  "text",
] as const;

export type CardKind = (typeof CARD_KINDS)[number];

/** One row of the card view: where it sits and how it reads. */
export type CardRow = { place: CardPlace; mode: CardMode };

/**
 * What every card in the project carries. `order` decides which row is drawn
 * first where two share a place; `rows` says where each one sits. A row nobody
 * named falls back to the place its kind belongs in, so a new property lands
 * on the card the way it always did.
 */
export type CardView = { order: string[]; rows: Record<string, CardRow> };

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

/**
 * The word that says how a rule reads its property. Nothing here names a
 * field: a rule holds a property id, and the property says which of these it
 * can answer. `src/lib/filters.ts` holds the rules themselves.
 */
export const FILTER_OPS = [
  /* select, multi_select, person, checkbox: the value is one of a chosen set */
  "is",
  "is_not",
  /* text */
  "contains",
  "not_contains",
  /* number */
  "eq",
  "gt",
  "lt",
  /* date */
  "on",
  "before",
  "after",
  /* anything that can hold nothing */
  "empty",
  "not_empty",
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

/** The member of a value set that stands for "this task holds nothing here". */
export const NO_VALUE_KEY = "__none__";

/**
 * One rule. `values` carries option ids, member ids, "true" / "false" or
 * NO_VALUE_KEY for the set operators; `text` carries the one word a text,
 * number or date rule compares against. A rule never carries both.
 */
export type FilterRule = {
  propertyId: string;
  op: FilterOp;
  values?: string[];
  /** The text, the number as text, or a date as 2026-08-25. */
  text?: string;
};

/** Every rule of a view. They all have to pass: a filter narrows, never widens. */
export type ViewFilters = {
  rules: FilterRule[];
};

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

export const SORT_DIRECTIONS = ["asc", "desc"] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * The order a list is drawn in, when somebody has asked for one. `columnId` is
 * a property, or one of the parts a task has of its own — the same ids the
 * card view is made of, because a list's columns are the card view.
 *
 * It writes nothing. The rank a task carries is the one order every view
 * shares and it stays where it is, so a view with a sort is showing an order
 * it cannot save — which is exactly why a sorted list cannot be dragged.
 * `src/lib/sort.ts` holds the comparing.
 */
export type ViewSort = {
  columnId: string;
  direction: SortDirection;
};

/**
 * The shape a view draws the same tasks in. A board puts them in columns; a
 * list puts them in one dense line-per-task, which is what a long backlog
 * wants. Nothing else about a view changes with the kind: the filters, the
 * card view and the one card order are shared by both.
 */
export const VIEW_KINDS = ["board", "list"] as const;

export type ViewKind = (typeof VIEW_KINDS)[number];

export const VIEW_KIND_LABEL: Record<ViewKind, string> = {
  board: "Board",
  list: "List",
};

export const VIEW_KIND_HINT: Record<ViewKind, string> = {
  board: "Cards in columns, one column for each value.",
  list: "One task on each line, with the columns you choose.",
};

export type ViewDTO = {
  id: string;
  name: string;
  /** board | list. What shape this view draws the tasks in. */
  kind: ViewKind;
  /** The property the columns come from. A list may have none. */
  groupById: string | null;
  position: string;
  isDefault: boolean;
  /** Which tasks this view shows. Every rule has to pass. */
  filters: ViewFilters;
  /**
   * The order a list draws them in, or null for the rank every view shares.
   * A board keeps one it was given but never reads it, exactly as it keeps a
   * grouping property it is not using.
   */
  sort: ViewSort | null;
};

export type ChecklistItemDTO = {
  id: string;
  text: string;
  done: boolean;
  position: string;
};

export type CommentDTO = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; color: string } | null;
};

export type ActivityDTO = {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; name: string; color: string } | null;
};

export type TaskDetailDTO = TaskDTO & {
  checklist: ChecklistItemDTO[];
  comments: CommentDTO[];
  activity: ActivityDTO[];
  /** The open run of this task, with its plan and its log. */
  run: AgentRunDetailDTO | null;
};

/* ------------------------------------------------------------------ */
/* Agent runs                                                          */
/* ------------------------------------------------------------------ */

export const RUN_STATUSES = [
  "running",
  "paused",
  "done",
  "failed",
  "stopped",
  "taken_over",
  "lost",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** A run is over once it reaches one of these. */
export const CLOSED_STATUSES: RunStatus[] = ["done", "failed", "stopped", "taken_over", "lost"];

export const RUN_CONTROLS = ["pause", "resume", "stop"] as const;

export type RunControl = (typeof RUN_CONTROLS)[number];

export type RunStepState = "todo" | "active" | "done";

export type AgentRunStepDTO = {
  id: string;
  text: string;
  state: RunStepState;
  index: number;
};

export type AgentRunLogDTO = {
  id: string;
  text: string;
  createdAt: string;
};

export type AgentRunDTO = {
  id: string;
  taskId: string;
  status: RunStatus;
  goal: string;
  /** What the agent is doing right now, in one line. */
  step: string;
  control: RunControl | null;
  startedAt: string;
  /** The last report. It moves only when the agent says the work moved. */
  updatedAt: string;
  /** The last sign of life. A beat writes this and nothing else. */
  beatAt: string;
  endedAt: string | null;
  agent: { id: string; name: string; color: string };
  stepsTotal: number;
  stepsDone: number;
  /** The newest line of the log. The panel shows the rest. */
  lastLog: string | null;
};

export type AgentRunDetailDTO = AgentRunDTO & {
  steps: AgentRunStepDTO[];
  log: AgentRunLogDTO[];
};

export type AgentTokenDTO = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type AgentDTO = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  tokens: AgentTokenDTO[];
};

export type ProjectDTO = {
  id: string;
  name: string;
  key: string;
  ownerId: string;
  role: string;
};

export type BoardData = {
  project: ProjectDTO;
  members: MemberDTO[];
  properties: PropertyDTO[];
  views: ViewDTO[];
  /** What a card carries, read afresh: a row naming a dead property is gone. */
  cardView: CardView;
  tasks: TaskDTO[];
  /** Only the runs that are still open. One per task at most. */
  runs: AgentRunDTO[];
};
