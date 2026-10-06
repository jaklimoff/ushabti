import { keyName } from "./filters";
import { isSelect, NO_VALUE_KEY, type PropertyDTO, type TaskValue, type When } from "./types";

/**
 * When a property shows on a task.
 *
 * A property may name one select and a set of its options: "Severity, shown
 * when Type is Bug". A task then draws it only while its value of that select
 * is in the set. This is what lets a type be a value and not a thing. Nothing
 * here names Type: any select answers.
 */

/**
 * The rule a property carries, made safe to use.
 *
 * Read afresh and never cleaned up, exactly as the done rule is. A deleted
 * property, one that is not a single select, the property itself, or a set
 * left empty reads as null, which is always shown: a rule nobody can see must
 * never hide a field. Deleted options drop out of the set.
 */
export function readWhen(raw: unknown, properties: PropertyDTO[], selfId: string): When | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { propertyId, optionIds } = raw as { propertyId?: unknown; optionIds?: unknown };
  if (typeof propertyId !== "string" || !Array.isArray(optionIds)) return null;
  if (propertyId === selfId) return null;
  const property = properties.find((p) => p.id === propertyId);
  if (!property || !isSelect(property.type)) return null;
  const known = new Set([NO_VALUE_KEY, ...property.options.map((o) => o.id)]);
  const kept = [...new Set(optionIds)].filter(
    (id): id is string => typeof id === "string" && known.has(id),
  );
  return kept.length ? { propertyId, optionIds: kept } : null;
}

/**
 * Every property with its rule read, and with no rule when it reads as none.
 *
 * Rules that point round in a circle all read as always shown: two selects
 * that each hide the other would leave a task with neither value unable to
 * show, and so to set, either one. A chain is fine: with no circle left,
 * `isShown` walks it to a select with no rule, and a link that is hidden
 * hides everything after it.
 */
export function readWhens(properties: PropertyDTO[]): PropertyDTO[] {
  const read = new Map<string, When>();
  for (const p of properties) {
    const when = readWhen(p.config.when, properties, p.id);
    if (when) read.set(p.id, when);
  }
  const circled = new Set<string>();
  for (const id of read.keys()) {
    let at = read.get(id)?.propertyId;
    for (let step = 0; at && step < properties.length; step++) {
      if (at === id) {
        circled.add(id);
        break;
      }
      at = read.get(at)?.propertyId;
    }
  }
  return properties.map((p) => {
    if (p.config.when === undefined) return p;
    const when = circled.has(p.id) ? undefined : read.get(p.id);
    return { ...p, config: withWhen(p, when ?? null) };
  });
}

/**
 * True when this property shows for a task with these values.
 *
 * The rule must already be read: the board and the export carry only the read
 * one. The panel and `chipsFor` both ask this, so a card, a list cell and the
 * panel cannot disagree. The select a rule names must show too: a type changed
 * away from Bug hides Severity, and with it what Severity's old value showed.
 */
export function isShown(
  property: PropertyDTO,
  values: Record<string, TaskValue>,
  properties: PropertyDTO[],
): boolean {
  const when = property.config.when;
  if (!when) return true;
  const value = values[when.propertyId];
  const key = typeof value === "string" && value !== "" ? value : NO_VALUE_KEY;
  if (!when.optionIds.includes(key)) return false;
  const named = properties.find((p) => p.id === when.propertyId);
  return !named || isShown(named, values, properties);
}

/** The rule in words: "Shown when Type is Bug or Story". */
export function whenSaid(when: When, properties: PropertyDTO[]): string {
  const property = properties.find((p) => p.id === when.propertyId);
  if (!property) return "";
  const names = when.optionIds.map((id) => keyName(id, property, []));
  return `Shown when ${property.name} is ${names.join(" or ")}`;
}

/** The config with this rule put on it, or taken off it by null. */
export function withWhen(property: PropertyDTO, when: When | null): PropertyDTO["config"] {
  const config = { ...property.config };
  delete config.when;
  return when ? { ...config, when } : config;
}

/* ------------------------------------------------------------------ */
/* Values a task does not show                                         */
/* ------------------------------------------------------------------ */

/**
 * A hidden value must never act. A Done that nobody can see would still close
 * a blocker, pass a filter and leave in the export, so a value goes the moment
 * its property stops showing. Everything below asks `isShown`, so the server
 * that drops and the question that asks first cannot disagree.
 */

/** True when a value holds something a person would miss. */
export function carriesValue(value: TaskValue | undefined): boolean {
  if (value === null || value === undefined || value === "") return false;
  return !Array.isArray(value) || value.length > 0;
}

/** The properties that hold a value on this task and that it does not show. */
export function hiddenOf(
  values: Record<string, TaskValue>,
  properties: PropertyDTO[],
): PropertyDTO[] {
  return properties.filter((p) => carriesValue(values[p.id]) && !isShown(p, values, properties));
}

/** The values with every one that does not show taken away, empty or not. */
export function withoutHidden(
  values: Record<string, TaskValue>,
  properties: PropertyDTO[],
): Record<string, TaskValue> {
  const kept: Record<string, TaskValue> = {};
  for (const [id, value] of Object.entries(values)) {
    const property = properties.find((p) => p.id === id);
    if (!property || isShown(property, values, properties)) kept[id] = value;
  }
  return kept;
}

/** What setting one value would take away from a task. */
export function droppedBy(
  values: Record<string, TaskValue>,
  properties: PropertyDTO[],
  propertyId: string,
  value: TaskValue,
): PropertyDTO[] {
  return hiddenOf({ ...values, [propertyId]: value }, properties);
}

/**
 * The option that hid these, by name, for the line in the activity.
 *
 * Each property's rules are walked to the first one its task fails, which is
 * the select whose value hid it; in a chain that can be a select further up.
 * A name is given only when one option hid them all: two causes, or a select
 * left empty, have no one name, and the line then says what went alone.
 */
export function hidBy(
  values: Record<string, TaskValue>,
  properties: PropertyDTO[],
  hidden: PropertyDTO[],
): string | null {
  const causes = new Set(hidden.map((p) => causeOf(p, values, properties)));
  if (causes.size !== 1) return null;
  return [...causes][0];
}

function causeOf(
  property: PropertyDTO,
  values: Record<string, TaskValue>,
  properties: PropertyDTO[],
): string | null {
  let at: PropertyDTO | undefined = property;
  for (let step = 0; at?.config.when && step <= properties.length; step++) {
    const when: When = at.config.when;
    const value = values[when.propertyId];
    const key = typeof value === "string" && value !== "" ? value : NO_VALUE_KEY;
    const named = properties.find((p) => p.id === when.propertyId);
    if (!when.optionIds.includes(key)) {
      return named?.options.find((o) => o.id === key)?.name ?? null;
    }
    at = named;
  }
  return null;
}

/** "Severity", "Severity and Repro", "Severity, Repro and Steps". */
export function namesSaid(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A value as the question names it: the option, or "nothing". */
export function valueSaid(property: PropertyDTO, value: TaskValue): string {
  if (!carriesValue(value)) return "nothing";
  if (typeof value === "string") {
    const option = property.options.find((o) => o.id === value);
    if (option) return option.name;
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** The panel's question: "Change Type to Story? Severity and Repro lose their values." */
export function changeAsked(property: PropertyDTO, value: TaskValue, lost: PropertyDTO[]): string {
  const names = namesSaid(lost.map((p) => p.name));
  const tail = lost.length === 1 ? "loses its value" : "lose their values";
  return `Change ${property.name} to ${valueSaid(property, value)}? ${names} ${tail}.`;
}

/** What a bulk set takes away: how many values, and of which properties. */
export function pickedDrops(
  tasks: { values: Record<string, TaskValue> }[],
  properties: PropertyDTO[],
  propertyId: string,
  value: TaskValue,
): { values: number; names: string[] } {
  let count = 0;
  const names: string[] = [];
  for (const task of tasks) {
    for (const p of droppedBy(task.values, properties, propertyId, value)) {
      count += 1;
      if (!names.includes(p.name)) names.push(p.name);
    }
  }
  return { values: count, names };
}

/** The pick bar's question: "Set Type to Story on 4 tasks? 3 values go (Severity, Repro)." */
export function pickedAsked(
  property: PropertyDTO,
  value: TaskValue,
  tasks: number,
  drops: { values: number; names: string[] },
): string {
  const on = tasks === 1 ? "1 task" : `${tasks} tasks`;
  const go = drops.values === 1 ? "1 value goes" : `${drops.values} values go`;
  return `Set ${property.name} to ${valueSaid(property, value)} on ${on}? ${go} (${drops.names.join(", ")}).`;
}

/**
 * What a new rule on one property takes away: how many tasks lose a value,
 * and of which properties. A rule can hide a select that other rules name,
 * so the names can be more than the one property.
 */
export function ruleDrops(
  tasks: { values: Record<string, TaskValue> }[],
  properties: PropertyDTO[],
  propertyId: string,
  when: When | null,
): { tasks: number; names: string[] } {
  const after = readWhens(
    properties.map((p) => (p.id === propertyId ? { ...p, config: withWhen(p, when) } : p)),
  );
  let count = 0;
  const names: string[] = [];
  for (const task of tasks) {
    const lost = hiddenOf(task.values, after);
    if (!lost.length) continue;
    count += 1;
    for (const p of lost) if (!names.includes(p.name)) names.push(p.name);
  }
  return { tasks: count, names };
}

/** The settings question: "12 tasks lose their Severity". */
export function ruleAsked(drops: { tasks: number; names: string[] }): string {
  const names = namesSaid(drops.names);
  return drops.tasks === 1
    ? `1 task loses its ${names}`
    : `${drops.tasks} tasks lose their ${names}`;
}

/** The line in a task's activity: "Story hid Severity and Repro, and their values were dropped". */
export function droppedSaid(by: string | null, names: string[]): string {
  const said = namesSaid(names);
  const one = names.length === 1;
  const tail = one ? "its value was dropped" : "their values were dropped";
  return by
    ? `${by} hid ${said}, and ${tail}`
    : `${said} ${one ? "was" : "were"} hidden, and ${tail}`;
}

/* ------------------------------------------------------------------ */
/* The Type                                                            */
/* ------------------------------------------------------------------ */

/**
 * The select this project names as its Type, made safe to use.
 *
 * Read afresh and never cleaned up, exactly as `progressBy` is: a project
 * that names a property that is gone, or that is no longer a single select,
 * has no Type. A type is then only an option of that select, and every rule
 * above already answers for it.
 */
export function readTypeBy(raw: unknown, properties: PropertyDTO[]): string | null {
  if (typeof raw !== "string") return null;
  const property = properties.find((p) => p.id === raw);
  return property && isSelect(property.type) ? raw : null;
}

/* ------------------------------------------------------------------ */
/* What a new task starts with                                         */
/* ------------------------------------------------------------------ */

/**
 * True for the types that can carry a value a new task starts with. A person
 * never: who works on a task is a choice, not a default. A date is a day that
 * passes, a link points at one thing, and a sprint closes.
 */
export function canStartAs(type: string): boolean {
  return ["select", "multi_select", "checkbox", "number", "text"].includes(type);
}

/** One default as it would be written, or undefined when it does not read. */
export function readDefault(raw: unknown, property: PropertyDTO): TaskValue | undefined {
  const live = new Set(property.options.map((o) => o.id));
  switch (property.type) {
    case "select":
      return typeof raw === "string" && live.has(raw) ? raw : undefined;
    case "multi_select": {
      if (!Array.isArray(raw)) return undefined;
      const kept = [...new Set(raw)].filter((id): id is string => live.has(id as string));
      return kept.length ? kept : undefined;
    }
    case "checkbox":
      return typeof raw === "boolean" ? raw : undefined;
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
    case "text":
      return typeof raw === "string" && raw.trim() !== "" ? raw.slice(0, 2000) : undefined;
    default:
      return undefined;
  }
}

/**
 * Every property with its defaults read against the project's Type.
 *
 * Read afresh and never cleaned up, as a rule is. An entry whose type is not
 * a live option of the Type, or whose value no longer reads, drops out; with
 * no Type, or on a property that cannot start as anything, all of them do.
 * The Type select itself starts as nothing: its value is the type.
 */
export function readDefaults(properties: PropertyDTO[], rawTypeBy: unknown): PropertyDTO[] {
  const typeById = readTypeBy(rawTypeBy, properties);
  const type = properties.find((p) => p.id === typeById);
  const types = new Set(type?.options.map((o) => o.id) ?? []);
  return properties.map((p) => {
    if (p.config.defaults === undefined) return p;
    const raw = p.config.defaults as unknown;
    const kept: Record<string, TaskValue> = {};
    if (p.id !== typeById && canStartAs(p.type) && isRecord(raw)) {
      for (const [optionId, value] of Object.entries(raw)) {
        const read = types.has(optionId) ? readDefault(value, p) : undefined;
        if (read !== undefined) kept[optionId] = read;
      }
    }
    const config = { ...p.config };
    delete config.defaults;
    return { ...p, config: Object.keys(kept).length ? { ...config, defaults: kept } : config };
  });
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/**
 * The values a new task of this type starts with: the defaults of the
 * properties that have no value yet and that show on it.
 *
 * A default can show another property, or hide one, so they are taken until
 * nothing more shows, and only those that show at the end are given. The
 * properties must already be read with `readWhens` and `readDefaults`.
 */
export function defaultsFor(
  typeOptionId: string,
  properties: PropertyDTO[],
  values: Record<string, TaskValue>,
): Record<string, TaskValue> {
  const taken: Record<string, TaskValue> = {};
  for (let added = true; added;) {
    added = false;
    for (const p of properties) {
      const value = p.config.defaults?.[typeOptionId];
      if (value === undefined || values[p.id] !== undefined || p.id in taken) continue;
      if (!isShown(p, { ...values, ...taken }, properties)) continue;
      taken[p.id] = value;
      added = true;
    }
  }
  const after = { ...values, ...taken };
  const shown: Record<string, TaskValue> = {};
  for (const [id, value] of Object.entries(taken)) {
    const p = properties.find((q) => q.id === id);
    if (p && isShown(p, after, properties)) shown[id] = value;
  }
  return shown;
}

/**
 * The defaults for a task about to carry these values: its type is the value
 * of the Type select, and with no Type or no value there is none. The create
 * route and the composer both ask this, so the note says what is written.
 */
export function startsWith(
  typeById: string | null,
  values: Record<string, TaskValue>,
  properties: PropertyDTO[],
): Record<string, TaskValue> {
  const type = typeById ? values[typeById] : null;
  return typeof type === "string" && type !== "" ? defaultsFor(type, properties, values) : {};
}

/** One property as the Types page lists it under one type. */
export type TypeRow = {
  property: PropertyDTO;
  /** What else it is on, by name, in the order of the select, then "No type". */
  also: string[];
};

/**
 * What one type shows, in the four groups of the Types page.
 *
 * The properties must already be read with `readWhens`, so a rule that does
 * not hold reads as none and the property is on every type. The Type select
 * itself is in no group: it is what a type is, not a field of one.
 */
export function typeSheet(
  properties: PropertyDTO[],
  typeById: string,
  optionId: string,
): {
  every: PropertyDTO[];
  here: TypeRow[];
  elsewhere: TypeRow[];
  ruledBy: { property: PropertyDTO; said: string }[];
} {
  const type = properties.find((p) => p.id === typeById);
  const sheet = {
    every: [] as PropertyDTO[],
    here: [] as TypeRow[],
    elsewhere: [] as TypeRow[],
    ruledBy: [] as { property: PropertyDTO; said: string }[],
  };
  if (!type) return sheet;
  for (const property of properties) {
    if (property.id === typeById) continue;
    const when = property.config.when;
    if (!when) {
      sheet.every.push(property);
      continue;
    }
    if (when.propertyId !== typeById) {
      sheet.ruledBy.push({ property, said: whenSaid(when, properties) });
      continue;
    }
    const others = type.options.filter((o) => o.id !== optionId && when.optionIds.includes(o.id));
    const also = others.map((o) => o.name);
    /* A rule that keeps "nothing yet" shows on an untyped task too, so this
       type is not its only one. */
    if (when.optionIds.includes(NO_VALUE_KEY)) also.push(keyName(NO_VALUE_KEY, type, []));
    const row = { property, also };
    if (when.optionIds.includes(optionId)) sheet.here.push(row);
    else sheet.elsewhere.push(row);
  }
  return sheet;
}
