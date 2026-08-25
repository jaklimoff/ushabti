import {
  FILTER_OPS,
  NO_VALUE_KEY,
  type FilterOp,
  type FilterRule,
  type MemberDTO,
  type PropertyDTO,
  type PropertyType,
  type TaskDTO,
  type TaskValue,
  type ViewFilters,
} from "./types";

/**
 * A filter is a rule about one property. Nothing here names Status, Priority or
 * a due date: a rule holds a property id, and the property says how to read it.
 * Adding a property type means adding a case to `matches`, and nothing else.
 *
 * The words a rule is made of live in `types.ts`, beside the DTO that carries
 * them. What they mean lives here.
 */

export const EMPTY_FILTERS: ViewFilters = { rules: [] };

/* ------------------------------------------------------------------ */
/* What each type may ask                                              */
/* ------------------------------------------------------------------ */

/**
 * The operators a property type offers, in the order the menu shows them. The
 * first one is what a new rule starts as, so it is the question people ask most.
 */
export const OPS_FOR_TYPE: Record<PropertyType, FilterOp[]> = {
  select: ["is", "is_not"],
  multi_select: ["is", "is_not"],
  person: ["is", "is_not"],
  checkbox: ["is"],
  text: ["contains", "not_contains", "empty", "not_empty"],
  number: ["eq", "gt", "lt", "empty", "not_empty"],
  date: ["on", "before", "after", "empty", "not_empty"],
};

/** True when the operator takes a set of values rather than one piece of text. */
export function isSetOp(op: FilterOp): boolean {
  return op === "is" || op === "is_not";
}

/** True when the operator takes nothing at all. */
export function isBareOp(op: FilterOp): boolean {
  return op === "empty" || op === "not_empty";
}

/**
 * True when a rule has an answer and not only a question.
 *
 * Picking a property says what is being asked about; it never says what the
 * answer is, because the board cannot know. Until somebody says, there is no
 * rule: nothing is written, nothing is broadcast, and no chip is drawn. This is
 * the one place that decides it, so the panel and the reader always agree.
 *
 * "Is empty" is its own answer, which is why a bare operator counts.
 */
export function hasAnswer(rule: FilterRule): boolean {
  if (isBareOp(rule.op)) return true;
  if (isSetOp(rule.op)) return (rule.values ?? []).length > 0;
  return (rule.text ?? "").trim() !== "";
}

export const OP_LABEL: Record<FilterOp, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "does not contain",
  eq: "is",
  gt: "is over",
  lt: "is under",
  on: "is on",
  before: "is before",
  after: "is after",
  empty: "is empty",
  not_empty: "is not empty",
};

/* ------------------------------------------------------------------ */
/* Reading a value                                                     */
/* ------------------------------------------------------------------ */

/**
 * The value of a task, as the set of keys a rule can match. A select gives one
 * key, a multi-select gives one per option, a checkbox gives "true" or "false",
 * and anything with nothing in it gives NO_VALUE_KEY. This is what lets one
 * operator serve four types.
 */
function keysOf(value: TaskValue, type: PropertyType): string[] {
  if (type === "checkbox") return [value === true ? "true" : "false"];
  if (Array.isArray(value)) return value.length ? value.map(String) : [NO_VALUE_KEY];
  if (value === null || value === undefined || value === "") return [NO_VALUE_KEY];
  return [String(value)];
}

/** True when the task holds nothing for this property. */
function isEmpty(value: TaskValue, type: PropertyType): boolean {
  // A checkbox is never empty. Off is a value, and a rule that called it empty
  // would hide every task nobody had ticked.
  if (type === "checkbox") return false;
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || value === "";
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/** True when one task passes one rule. An unreadable rule passes everything. */
export function matches(task: TaskDTO, rule: FilterRule, property: PropertyDTO): boolean {
  const value = task.values[rule.propertyId] ?? null;
  const type = property.type;

  switch (rule.op) {
    case "empty":
      return isEmpty(value, type);
    case "not_empty":
      return !isEmpty(value, type);

    case "is":
    case "is_not": {
      const wanted = rule.values ?? [];
      // A set with nothing chosen asks nothing, so it hides nothing.
      if (wanted.length === 0) return true;
      const held = keysOf(value, type);
      const hit = held.some((key) => wanted.includes(key));
      return rule.op === "is" ? hit : !hit;
    }

    case "contains":
    case "not_contains": {
      const needle = (rule.text ?? "").trim().toLowerCase();
      if (!needle) return true;
      const hay = typeof value === "string" ? value.toLowerCase() : "";
      const hit = hay.includes(needle);
      return rule.op === "contains" ? hit : !hit;
    }

    case "eq":
    case "gt":
    case "lt": {
      const against = Number(rule.text);
      if (rule.text === undefined || rule.text === "" || !Number.isFinite(against)) return true;
      if (typeof value !== "number") return false;
      if (rule.op === "eq") return value === against;
      return rule.op === "gt" ? value > against : value < against;
    }

    case "on":
    case "before":
    case "after": {
      const against = rule.text ?? "";
      if (!against) return true;
      if (typeof value !== "string" || !value) return false;
      // Both are YYYY-MM-DD, so text order is date order. No Date, no timezone,
      // and the same answer on the server and in the browser.
      if (rule.op === "on") return value === against;
      return rule.op === "before" ? value < against : value > against;
    }

    default:
      return true;
  }
}

/* ------------------------------------------------------------------ */
/* Reading what was saved                                              */
/* ------------------------------------------------------------------ */

function isOp(value: unknown): value is FilterOp {
  return typeof value === "string" && (FILTER_OPS as readonly string[]).includes(value);
}

/**
 * The rules of a saved view, with every rule that can no longer be read thrown
 * away. Nothing cleans a filter up when its property or its option is deleted,
 * so a view can hold a rule that points at nothing. A rule nobody can see must
 * never keep hiding cards, which is why this runs before the board draws the
 * chips and again before it hides anything: the two always agree.
 */
export function readFilters(raw: unknown, properties: PropertyDTO[]): ViewFilters {
  const list = (raw as { rules?: unknown })?.rules;
  if (!Array.isArray(list)) return EMPTY_FILTERS;

  const byId = new Map(properties.map((p) => [p.id, p]));
  const rules: FilterRule[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Partial<FilterRule>;
    const property = typeof raw.propertyId === "string" ? byId.get(raw.propertyId) : undefined;
    if (!property || !isOp(raw.op)) continue;
    if (!OPS_FOR_TYPE[property.type].includes(raw.op)) continue;

    let built: FilterRule;
    if (isBareOp(raw.op)) {
      built = { propertyId: property.id, op: raw.op };
    } else if (isSetOp(raw.op)) {
      const live = liveKeys(property);
      const values = (Array.isArray(raw.values) ? raw.values : [])
        .filter((v): v is string => typeof v === "string")
        .filter((v) => live === null || live.has(v));
      built = { propertyId: property.id, op: raw.op, values: Array.from(new Set(values)) };
    } else {
      built = {
        propertyId: property.id,
        op: raw.op,
        text: typeof raw.text === "string" ? raw.text.slice(0, 200) : "",
      };
    }

    // A rule with no answer left — every option it named was deleted, or the
    // box was emptied — is a question about nothing. It goes.
    if (hasAnswer(built)) rules.push(built);
  }

  return { rules };
}

/**
 * The keys a set rule may hold for this property, or null when the property
 * has no list to check against — a person rule names members, and a member who
 * left is still a fair question to ask about the tasks they left behind.
 */
function liveKeys(property: PropertyDTO): Set<string> | null {
  if (property.type === "select" || property.type === "multi_select") {
    return new Set([...property.options.map((o) => o.id), NO_VALUE_KEY]);
  }
  if (property.type === "checkbox") return new Set(["true", "false"]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Using them                                                          */
/* ------------------------------------------------------------------ */

/** The tasks a view shows. Every rule has to pass. */
export function applyFilters(
  tasks: TaskDTO[],
  filters: ViewFilters,
  properties: PropertyDTO[],
): TaskDTO[] {
  if (filters.rules.length === 0) return tasks;
  const byId = new Map(properties.map((p) => [p.id, p]));
  return tasks.filter((task) =>
    filters.rules.every((rule) => {
      const property = byId.get(rule.propertyId);
      return property ? matches(task, rule, property) : true;
    }),
  );
}

/**
 * The columns a filtered board keeps.
 *
 * A rule that names the grouping property also speaks about the columns: with
 * "Status is Todo" on a board grouped by Status, every other column is empty,
 * and an empty column you may still drop a card into is a trap — the card would
 * vanish the moment it landed. So the columns the rules exclude go too, and the
 * only columns left are ones a card can actually live in.
 *
 * Nothing is lost with them. A task in one of these columns holds the value the
 * column stands for, so it failed the same rule and is not on the board either.
 */
export function allowedColumns<T extends { value: TaskValue }>(
  columns: T[],
  filters: ViewFilters,
  groupProperty: PropertyDTO | null,
): T[] {
  if (!groupProperty) return columns;
  const rules = filters.rules.filter((r) => r.propertyId === groupProperty.id);
  if (rules.length === 0) return columns;

  return columns.filter((column) => {
    const stand = { values: { [groupProperty.id]: column.value } } as TaskDTO;
    return rules.every((rule) => matches(stand, rule, groupProperty));
  });
}

/* ------------------------------------------------------------------ */
/* A new task on a filtered board                                      */
/* ------------------------------------------------------------------ */

/**
 * The values a task needs to carry to survive the filters it is born into.
 *
 * Without this, adding a task to a filtered board is a trap: the card is
 * written, the board hides it on the same breath, and nothing on screen says
 * why. So the board fills in what the filter asks for.
 *
 * Only a rule it can answer without guessing: one that says a value *is*
 * something, and names exactly one. "Priority is High or Urgent" has no single
 * answer, "Priority is not Low" has too many, and the grouping property is the
 * column's to decide. Anything it cannot answer is left alone.
 */
export function seedValues(
  filters: ViewFilters,
  properties: PropertyDTO[],
  groupPropertyId: string | null,
): Record<string, TaskValue> {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const seed: Record<string, TaskValue> = {};

  for (const rule of filters.rules) {
    if (rule.op !== "is" || rule.propertyId === groupPropertyId) continue;
    const keys = rule.values ?? [];
    if (keys.length !== 1 || keys[0] === NO_VALUE_KEY) continue;
    const property = byId.get(rule.propertyId);
    if (!property) continue;

    switch (property.type) {
      case "multi_select":
        seed[property.id] = [keys[0]];
        break;
      case "checkbox":
        seed[property.id] = keys[0] === "true";
        break;
      case "select":
      case "person":
        seed[property.id] = keys[0];
        break;
      default:
        break;
    }
  }

  return seed;
}

/** What the composer says it is about to do, or "" when it does nothing. */
export function seedNote(
  seed: Record<string, TaskValue>,
  properties: PropertyDTO[],
  members: MemberDTO[],
): string {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const said: string[] = [];

  for (const [propertyId, value] of Object.entries(seed)) {
    const property = byId.get(propertyId);
    if (!property) continue;
    const key = Array.isArray(value) ? value[0] : value === true ? "true" : String(value);
    said.push(`${property.name} ${keyName(key, property, members)}`);
  }

  return said.length ? `sets ${said.join(", ")}` : "";
}

/* ------------------------------------------------------------------ */
/* Saying what a rule asks                                             */
/* ------------------------------------------------------------------ */

/**
 * The name of one key of a set rule, for the chip and for the menu.
 *
 * These are the words `buildColumns` already prints on a column header —
 * "Unassigned", "No due", "Not done" — and not "Empty", "On" and "Off". A
 * person who has read the board has then already read the filter.
 *
 * A key that names nothing left reads as "?" rather than disappearing, because
 * a chip that silently dropped a word would misdescribe what is being hidden.
 */
export function keyName(key: string, property: PropertyDTO, members: MemberDTO[]): string {
  if (key === NO_VALUE_KEY) {
    return property.type === "person" ? "Unassigned" : `No ${property.name.toLowerCase()}`;
  }
  if (property.type === "checkbox") {
    return key === "true" ? property.name : `Not ${property.name.toLowerCase()}`;
  }
  if (property.type === "person") return members.find((m) => m.id === key)?.name ?? "?";
  return property.options.find((o) => o.id === key)?.name ?? "?";
}

/** The colour of one key, for the dot on the chip. */
export function keyColor(key: string, property: PropertyDTO, members: MemberDTO[]): string {
  if (key === NO_VALUE_KEY) return "#3f4650";
  if (property.type === "checkbox") return key === "true" ? "#4f8a5b" : "#6b7280";
  if (property.type === "person") return members.find((m) => m.id === key)?.color ?? "#3f4650";
  return property.options.find((o) => o.id === key)?.color ?? "#3f4650";
}

/**
 * True when the name of this key already carries the property, so a chip that
 * said the property first would say it twice: "Unassigned", not "Assignee is
 * Unassigned"; "Not done", not "Done is Not done".
 */
function keySpeaksForItself(key: string, property: PropertyDTO): boolean {
  return key === NO_VALUE_KEY || property.type === "checkbox";
}

/** What one rule asks, in one short line. The chip and the title both use it. */
export function describeRule(
  rule: FilterRule,
  property: PropertyDTO,
  members: MemberDTO[],
): string {
  if (isBareOp(rule.op)) return `${property.name} ${OP_LABEL[rule.op]}`;
  if (isSetOp(rule.op)) {
    const keys = rule.values ?? [];
    if (rule.op === "is" && keys.length === 1 && keySpeaksForItself(keys[0], property)) {
      return keyName(keys[0], property, members);
    }
    const names = keys.map((key) => keyName(key, property, members));
    const said =
      names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
    return `${property.name} ${OP_LABEL[rule.op]} ${said}`;
  }
  return `${property.name} ${OP_LABEL[rule.op]} ${rule.text ?? ""}`.trim();
}
