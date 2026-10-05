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
