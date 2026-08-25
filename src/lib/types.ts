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

export type ViewDTO = {
  id: string;
  name: string;
  groupById: string | null;
  position: string;
  isDefault: boolean;
  /** Which tasks this view shows. Every rule has to pass. */
  filters: ViewFilters;
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
  tasks: TaskDTO[];
  /** Only the runs that are still open. One per task at most. */
  runs: AgentRunDTO[];
};
