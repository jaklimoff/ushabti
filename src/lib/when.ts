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
