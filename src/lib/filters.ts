import {
  DATE_WINDOW_NAME,
  DATE_WINDOW_SAID,
  isDateWindow,
  windowDays,
  type DateWindow,
} from "./day";
import {
  FILTER_OPS,
  NO_VALUE_KEY,
  type FilterOp,
  type FilterRule,
  type MemberDTO,
  type PropertyDTO,
  type PropertyType,
  type AgentRunRowDTO,
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
/* The one rule that is not about a property                           */
/* ------------------------------------------------------------------ */

/**
 * "Is this task waiting on another one?"
 *
 * It is a built-in rule the way `_key` is a built-in row of the card: a fixed
 * word, not a property, and nothing writes it. A blocked-by link is not a
 * field on a task, so there is no property to filter by and adding one would
 * put a fixed field back on the board.
 *
 * The word is read as a checkbox, so every part of a filter already knows
 * what to do with it: one operator, two values, a chip that says "Blocked" or
 * "Not blocked". `readFilters` keeps it, because a word cannot be deleted,
 * and `seedValues` skips it, because there is nothing to write.
 */
export const BLOCKED_KEY = "_blocked";

/**
 * "Is an agent waiting on a person here?"
 *
 * The second built-in word, and built exactly as the first one is. A run is
 * not a field on a task either, so it reads off the open run rather than off
 * the values, and it is a checkbox from there on.
 *
 * Only `waiting` counts, and not every word of `WAITING_STATUSES`. A run that
 * waits asked a person something and cannot go on until somebody answers; a
 * hand-over gave the task away and waits for nobody in particular. The rule
 * answers one question — where does an agent wait for me — and the answer
 * leaves it the moment the run moves on.
 */
export const AGENT_WAITING_KEY = "_agent_waiting";

/**
 * The tasks whose open run waits for a person, by id.
 *
 * The board carries the open runs beside the tasks rather than on them, so the
 * caller hands this in the way it hands in `today`: one answer for the whole
 * board, worked out once.
 */
export function waitingTasks(runs: Pick<AgentRunRowDTO, "taskId" | "status">[]): Set<string> {
  return new Set(runs.filter((run) => run.status === "waiting").map((run) => run.taskId));
}

/**
 * The member of a person rule's set that stands for whoever is reading.
 *
 * It is a value, as NO_VALUE_KEY is, and never the id of a person: the view is
 * shared, so "Assignee is Me" has to mean me on my screen and you on yours.
 * The stored rule keeps the word. `matches` reads it against the viewer it is
 * handed, and `seedValues` writes that viewer, so nothing rewrites the rule.
 * An agent reads it as itself. With nobody to read it as, it matches nobody.
 */
export const ME_KEY = "__me__";

/**
 * The rule's stand-in property. A checkbox is what it reads like, so it is
 * one: the menu, the chip and the matching all follow from the type.
 */
export const BLOCKED_PROPERTY: PropertyDTO = {
  id: BLOCKED_KEY,
  name: "Blocked",
  type: "checkbox",
  position: "",
  config: {},
  options: [],
};

/** The stand-in of the second word, a checkbox for the same reason. */
export const AGENT_WAITING_PROPERTY: PropertyDTO = {
  id: AGENT_WAITING_KEY,
  name: "Agent waiting",
  type: "checkbox",
  position: "",
  config: {},
  options: [],
};

/** The words that are not properties, in the order the panel lists them. */
const BUILT_IN: PropertyDTO[] = [BLOCKED_PROPERTY, AGENT_WAITING_PROPERTY];

/** True when a rule names one of the words rather than a property. */
export function isBuiltIn(propertyId: string): boolean {
  return BUILT_IN.some((p) => p.id === propertyId);
}

/**
 * The properties a filter may ask about: the project's, and the words that
 * are not properties. The panel and the chips read this; nothing else does,
 * because nothing else may put "Blocked" where a property belongs.
 */
export function filterProperties(properties: PropertyDTO[]): PropertyDTO[] {
  return [...properties, ...BUILT_IN];
}

/** The properties by id, with the built-in words among them. */
function byIdWithBuiltIn(properties: PropertyDTO[]): Map<string, PropertyDTO> {
  const byId = new Map(properties.map((p) => [p.id, p]));
  for (const word of BUILT_IN) byId.set(word.id, word);
  return byId;
}

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
  date: ["on", "before", "after", "within", "empty", "not_empty"],
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
 * True when the operator takes the name of a window of days rather than a day.
 *
 * It reads `text` like the other date operators, which is why `hasAnswer`
 * needs no case for it: a wordless "is within" is a question with no answer,
 * and nothing is written until somebody picks a window.
 */
export function isWindowOp(op: FilterOp): boolean {
  return op === "within";
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
  within: "is within",
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

/**
 * True when one task passes one rule. An unreadable rule passes everything.
 *
 * `today` is the day the board was read on, in the project's zone. It is
 * handed in and never looked up, the way `lifeOf` is handed the clock — but
 * with no default, because a default would be a clock and this function runs
 * once on the server and again in the browser. Two clocks are two answers,
 * and the second one throws the first render away.
 *
 * `viewer` is the id of whoever reads the board, and it is what ME_KEY means.
 * It has no default for the same reason: a view is shared, so a caller that
 * forgot it would read "Me" as nobody on every screen.
 *
 * `waiting` is `waitingTasks()` of the open runs, and it has no default
 * either: a caller that forgot it would find no agent waiting anywhere.
 */
export function matches(
  task: TaskDTO,
  rule: FilterRule,
  property: PropertyDTO,
  today: string,
  viewer: string | null,
  waiting: ReadonlySet<string>,
): boolean {
  /* The built-in words read off the links and the runs rather than off the
     values, and nothing else about them differs: each is a checkbox from here
     down. */
  const value =
    rule.propertyId === BLOCKED_KEY
      ? (task.blockedBy?.length ?? 0) > 0
      : rule.propertyId === AGENT_WAITING_KEY
        ? waiting.has(task.id)
        : (task.values[rule.propertyId] ?? null);
  const type = property.type;

  switch (rule.op) {
    case "empty":
      return isEmpty(value, type);
    case "not_empty":
      return !isEmpty(value, type);

    case "is":
    case "is_not": {
      /* Me is read here and only here. Without a viewer the word stays as it
         is, and no task holds it, so it matches nobody. */
      const wanted = (rule.values ?? []).map((key) => (key === ME_KEY && viewer ? viewer : key));
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

    case "within": {
      const word = rule.text ?? "";
      // A word from a newer version, or from a hand-written rule. It asks
      // nothing this board can answer, so it hides nothing.
      if (!isDateWindow(word)) return true;
      const days = windowDays(word, today);
      if (!days) return true;
      if (typeof value !== "string" || !value) return false;
      // Both ends are YYYY-MM-DD, so text order is date order: no Date, no
      // zone, and the same answer on the server and in the browser.
      if (days.from !== null && value < days.from) return false;
      if (days.to !== null && value > days.to) return false;
      return true;
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

  const byId = byIdWithBuiltIn(properties);
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
    } else if (isWindowOp(raw.op)) {
      /* A window is one word from a closed list. A word that is not on it is
         a rule nobody can read, and it goes the way a dead option does —
         here, on every read, rather than in a cleanup pass that would have to
         run wherever a version changes. */
      const word = typeof raw.text === "string" ? raw.text : "";
      if (!isDateWindow(word)) continue;
      built = { propertyId: property.id, op: raw.op, text: word };
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
 * left is still a fair question to ask about the tasks they left behind. ME_KEY
 * passes the same way, and only a person rule can hold it: every other type
 * has a list, and the word is not on it.
 */
function liveKeys(property: PropertyDTO): Set<string> | null {
  if (property.type === "select" || property.type === "multi_select") {
    return new Set([...property.options.map((o) => o.id), NO_VALUE_KEY]);
  }
  if (property.type === "checkbox") return new Set(["true", "false"]);
  return null;
}

/**
 * The view's rules and one person's, as the one set that decides their screen.
 *
 * A filter narrows and never widens, so the two sets join by being put end to
 * end: every rule of both has to pass, exactly as two rules of a view do. The
 * view's come first because they are the ones everybody is looking at, and
 * because the strip draws them in this order.
 *
 * Everything that hides, counts or seeds reads this one answer, so a person's
 * screen can never disagree with itself. What a person may *remove* is the
 * only place the two are told apart, and that is the strip's business.
 */
export function mergeFilters(viewFilters: ViewFilters, lens: ViewFilters): ViewFilters {
  if (lens.rules.length === 0) return viewFilters;
  if (viewFilters.rules.length === 0) return lens;
  return { rules: [...viewFilters.rules, ...lens.rules] };
}

/** True when this set already asks something about this property. */
export function asksAbout(filters: ViewFilters, propertyId: string): boolean {
  return filters.rules.some((rule) => rule.propertyId === propertyId);
}

/**
 * The property a person's rules and the view's rules both name, or null.
 *
 * One property, one rule, whoever asked. A lens may only narrow, so a second
 * rule about a property the view already speaks about is a trap: "Priority is
 * High" on the view and "Priority is Low" of mine empties the board with two
 * chips and nothing that says why, and **Save for everyone** would hand that to
 * the team. It counts the property and not the operator, because nobody
 * reading two chips can tell a pair that narrows from a pair that can never
 * both pass.
 *
 * This is the one place that decides it, so the panel that refuses the pick
 * and the route that refuses the promote always agree, exactly as `hasAnswer`
 * serves the panel and the reader. `mergeFilters` stays a plain joining: the
 * guard belongs at the two doors a rule comes in by.
 *
 * It answers null for a rule whose property is not in `properties`, and that
 * is safe rather than lax: every caller reads both sets with `readFilters`
 * first, which throws a rule about a deleted property away before this sees
 * it. So the pair can never be "a clash nobody can name", and the alternative
 * — refusing on a property there is no name for — would give `clashSaid`
 * nothing to say and stop a person writing rules that hide nothing. The
 * browser asks with the properties it holds, which may be a moment behind; the
 * two routes ask with the ones they just read, and they are the answer.
 */
export function clashOf(
  viewFilters: ViewFilters,
  lens: ViewFilters,
  properties: PropertyDTO[],
): PropertyDTO | null {
  const rule = lens.rules.find((r) => asksAbout(viewFilters, r.propertyId));
  if (!rule) return null;
  /* The built-in word counts as a property here: two rules about it fight
     each other exactly as two about Priority would, and it has a name to put
     in the sentence. */
  return byIdWithBuiltIn(properties).get(rule.propertyId) ?? null;
}

/** The one sentence both doors say, so a person hears the same thing twice. */
export function clashSaid(property: PropertyDTO): string {
  return `The view already filters ${property.name}. Remove it for everyone first.`;
}

/* ------------------------------------------------------------------ */
/* Using them                                                          */
/* ------------------------------------------------------------------ */

const NO_RUNS: ReadonlySet<string> = new Set();

/** The tasks a view shows. Every rule has to pass. */
export function applyFilters(
  tasks: TaskDTO[],
  filters: ViewFilters,
  properties: PropertyDTO[],
  today: string,
  viewer: string | null,
  waiting: ReadonlySet<string>,
): TaskDTO[] {
  if (filters.rules.length === 0) return tasks;
  const byId = byIdWithBuiltIn(properties);
  return tasks.filter((task) =>
    filters.rules.every((rule) => {
      const property = byId.get(rule.propertyId);
      return property ? matches(task, rule, property, today, viewer, waiting) : true;
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
  today: string,
  viewer: string | null,
): T[] {
  if (!groupProperty) return columns;
  const rules = filters.rules.filter((r) => r.propertyId === groupProperty.id);
  if (rules.length === 0) return columns;

  return columns.filter((column) => {
    const stand = { values: { [groupProperty.id]: column.value } } as TaskDTO;
    /* The rules here name a property, never a word, so no run is asked. */
    return rules.every((rule) => matches(stand, rule, groupProperty, today, viewer, NO_RUNS));
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
 *
 * "Assignee is Me" has one answer, and it is `viewer`: the task goes to
 * whoever added it. With no viewer it has none, and it is left alone.
 */
export function seedValues(
  filters: ViewFilters,
  properties: PropertyDTO[],
  groupPropertyId: string | null,
  viewer: string | null,
): Record<string, TaskValue> {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const seed: Record<string, TaskValue> = {};

  for (const rule of filters.rules) {
    /* "is" and nothing else, so a relative date rule is skipped here as well:
       which day inside "this week" the task means is a guess, and this
       function never guesses. A task added under one is written with no date
       and hidden, which is the cost "Priority is High or Urgent" already
       carries. */
    if (rule.op !== "is" || rule.propertyId === groupPropertyId) continue;
    /* Nothing writes a link or a run from the composer, and a value for a
       word that is not a property would be written to a property that is not
       there. */
    if (isBuiltIn(rule.propertyId)) continue;
    const keys = rule.values ?? [];
    if (keys.length !== 1 || keys[0] === NO_VALUE_KEY) continue;
    const property = byId.get(rule.propertyId);
    if (!property) continue;
    if (keys[0] === ME_KEY) {
      if (property.type === "person" && viewer) seed[property.id] = viewer;
      continue;
    }

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
  if (key === ME_KEY) return "Me";
  if (property.type === "checkbox") {
    return key === "true" ? property.name : `Not ${property.name.toLowerCase()}`;
  }
  if (property.type === "person") return members.find((m) => m.id === key)?.name ?? "?";
  return property.options.find((o) => o.id === key)?.name ?? "?";
}

/**
 * What a chip says about a window: "Due this week".
 *
 * "Overdue" is left to speak for itself, exactly as "Unassigned" is: a chip
 * that put the property first would read "Due is overdue", which says the
 * same thing twice and says it badly.
 */
function windowSaid(property: PropertyDTO, word: string): string {
  if (!isDateWindow(word)) return property.name;
  if (word === "overdue") return DATE_WINDOW_NAME.overdue;
  return `${property.name} ${DATE_WINDOW_SAID[word as Exclude<DateWindow, "overdue">]}`;
}

/** The colour of one key, for the dot on the chip. */
export function keyColor(key: string, property: PropertyDTO, members: MemberDTO[]): string {
  if (key === NO_VALUE_KEY) return "#3f4650";
  /* Me is a different person on every screen, so it wears no one's colour. */
  if (key === ME_KEY) return "#6b7280";
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
  if (isWindowOp(rule.op)) return windowSaid(property, rule.text ?? "");
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
