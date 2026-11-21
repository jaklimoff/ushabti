import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects, properties, propertyOptions, tasks } from "@/db/schema";
import { readId } from "./api";
import { isId } from "./ids";
import { HttpError } from "./auth";
import type { PropertyType, TaskValue } from "./types";
import { LinkError, readLinks } from "./web-links";
import { hasOptions, isSelect } from "./types";

export type PropertyRow = {
  id: string;
  projectId: string;
  name: string;
  type: PropertyType;
};

export async function loadProperty(propertyId: string): Promise<PropertyRow> {
  readId(propertyId, "property");
  const [row] = await db
    .select({
      id: properties.id,
      projectId: properties.projectId,
      name: properties.name,
      type: properties.type,
    })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  if (!row) throw new HttpError(404, "Property not found.");
  return { ...row, type: row.type as PropertyType };
}

/**
 * Checks a raw value against the property type and returns what to store.
 * `self` is the tasks the value is written on, which a Tasks value may not
 * name: a task that is its own duplicate says nothing.
 */
export async function coerceValue(
  prop: PropertyRow,
  raw: unknown,
  self: readonly string[] = [],
): Promise<TaskValue> {
  if (raw === null || raw === undefined || raw === "") {
    return prop.type === "multi_select" || prop.type === "link" || prop.type === "relation"
      ? []
      : null;
  }

  switch (prop.type) {
    case "iteration":
    case "select": {
      if (typeof raw !== "string") throw new HttpError(400, `${prop.name} needs one option.`);
      await assertOptions(prop.id, [raw]);
      return raw;
    }
    case "multi_select": {
      if (!Array.isArray(raw)) throw new HttpError(400, `${prop.name} needs a list of options.`);
      const ids = raw.filter((v): v is string => typeof v === "string");
      if (ids.length) await assertOptions(prop.id, ids);
      return Array.from(new Set(ids));
    }
    case "person": {
      if (typeof raw !== "string") throw new HttpError(400, `${prop.name} needs one member.`);
      /* Asked of the database, a word that is no id is an error and not an answer. */
      if (!isId(raw)) throw new HttpError(400, "That person is not a member of this project.");
      const rows = await db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, prop.projectId), eq(projectMembers.userId, raw)))
        .limit(1);
      if (!rows.length) throw new HttpError(400, "That person is not a member of this project.");
      return raw;
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) throw new HttpError(400, `${prop.name} needs a number.`);
      return n;
    }
    case "checkbox":
      return raw === true || raw === "true";
    case "date": {
      if (typeof raw !== "string" || !isRealDay(raw)) {
        throw new HttpError(400, `${prop.name} needs a date like 2026-08-21.`);
      }
      return raw;
    }
    case "text": {
      if (typeof raw !== "string") throw new HttpError(400, `${prop.name} needs text.`);
      return raw.slice(0, 2000);
    }
    case "link": {
      try {
        return readLinks(raw);
      } catch (error) {
        if (error instanceof LinkError) throw new HttpError(400, `${prop.name} ${error.message}`);
        throw error;
      }
    }
    case "relation":
      return assertTasks(prop, raw, self);
    default:
      throw new HttpError(400, "Unknown property type.");
  }
}

/**
 * A Tasks value is a list of task ids of this project, each named once. An
 * archived task may be named, because it is still here; a deleted one may
 * not, because nothing may point at a mistake. A value already written is
 * never rewritten when its task goes: the reader drops what it cannot find.
 */
async function assertTasks(
  prop: PropertyRow,
  raw: unknown,
  self: readonly string[],
): Promise<string[]> {
  if (!Array.isArray(raw)) throw new HttpError(400, `${prop.name} needs a list of tasks.`);
  const ids = Array.from(new Set(raw));
  if (ids.some((id) => self.includes(id as string))) {
    throw new HttpError(400, "A task cannot point at itself.");
  }
  if (!ids.every(isId)) throw new HttpError(400, "That task is not in this project.");
  if (!ids.length) return [];
  const rows = await db
    .select({ id: tasks.id, projectId: tasks.projectId, deletedAt: tasks.deletedAt })
    .from(tasks)
    .where(inArray(tasks.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || row.projectId !== prop.projectId) {
      throw new HttpError(400, "That task is not in this project.");
    }
    if (row.deletedAt) throw new HttpError(400, "That task was deleted.");
  }
  return ids;
}

/** A day written 2026-08-21 that the calendar has. 2026-02-31 has the shape
    and would be drawn as the third of March. */
export function isRealDay(raw: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d;
}

async function assertOptions(propertyId: string, ids: string[]) {
  if (!ids.every(isId)) throw new HttpError(400, "One of the options does not exist any more.");
  const rows = await db
    .select({ id: propertyOptions.id })
    .from(propertyOptions)
    .where(and(eq(propertyOptions.propertyId, propertyId), inArray(propertyOptions.id, ids)));
  if (rows.length !== new Set(ids).size) {
    throw new HttpError(400, "One of the options does not exist any more.");
  }
}

/** What a value was before a write, in the words of `describeValue`. A
    multi-select and a Tasks value also say what came and what went. */
export type ValueWas = {
  value: TaskValue;
  described: string;
  added?: string[];
  removed?: string[];
};

/** One reading of a value for telling two apart: every empty is one empty,
    and a list is a set, since its order is only the order of the clicks. */
function sameValue(a: TaskValue, b: TaskValue): boolean {
  const key = (v: TaskValue) => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0))
      return "null";
    return JSON.stringify(Array.isArray(v) ? [...v].map(String).sort() : v);
  };
  return key(a) === key(b);
}

/** The data of a value line. The name is for people; the id and the type
    are for an agent, since a name can change. A person line names the
    person too, so a watcher can tell whether it is for it without reading
    the board. Fields are only ever added here: old watchers read the rest.
    `was` is required so that no write can forget what it replaced; a write
    that left the value as it was says nothing of it. */
export function valueLine(
  prop: Pick<PropertyRow, "id" | "name" | "type">,
  value: TaskValue,
  described: string,
  was: ValueWas,
): Record<string, unknown> {
  const line: Record<string, unknown> = {
    property: prop.name,
    propertyId: prop.id,
    type: prop.type,
    value: described,
  };
  if (prop.type === "person") line.personId = typeof value === "string" && value ? value : null;
  /* A chart counts by the id, because a renamed option keeps its id. */
  if (isSelect(prop.type)) line.optionId = typeof value === "string" && value ? value : null;
  if (prop.type === "multi_select") {
    line.optionIds = Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
  }
  /* The keys are for people and can be read again; the ids are what stays. */
  if (prop.type === "relation") {
    line.taskIds = Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
  }
  if (!sameValue(was.value, value)) {
    line.from = was.described;
    if (prop.type === "person") {
      line.fromPersonId = typeof was.value === "string" && was.value ? was.value : null;
    }
    if (was.added || was.removed) {
      line.added = was.added ?? [];
      line.removed = was.removed ?? [];
    }
  }
  return line;
}

/** The ids of a list value, for working out what a write added and took away. */
function idsOf(v: TaskValue): string[] {
  return (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string");
}

/**
 * A value line for a write from `before` to `value`, both described. It is
 * read inside the transaction that writes, so `before` is what the lock saw.
 * `describe` lets a write to many tasks name a value once for all of them.
 */
export async function changeLine(
  prop: Pick<PropertyRow, "id" | "name" | "type">,
  before: TaskValue | undefined,
  value: TaskValue,
  q: Pick<typeof db, "select"> = db,
  describe: (v: TaskValue) => Promise<string> = (v) => describeValue(prop, v, q),
): Promise<Record<string, unknown>> {
  /* A checkbox draws no empty: one nobody ticked was off. */
  const old: TaskValue = prop.type === "checkbox" ? Boolean(before) : (before ?? null);
  const was: ValueWas = { value: old, described: await describe(old) };
  if (prop.type === "multi_select" || prop.type === "relation") {
    const had = idsOf(old);
    const has = idsOf(value);
    was.added = await namesOf(
      prop,
      has.filter((id) => !had.includes(id)),
      q,
    );
    was.removed = await namesOf(
      prop,
      had.filter((id) => !has.includes(id)),
      q,
    );
  }
  return valueLine(prop, value, await describe(value), was);
}

/** The words for each id of an option or a Tasks value: the option's name,
    or the task's key. An id that is gone reads `?`. */
async function namesOf(
  prop: Pick<PropertyRow, "type">,
  ids: string[],
  q: Pick<typeof db, "select">,
): Promise<string[]> {
  if (!ids.length) return [];
  if (prop.type === "relation") {
    const real = ids.filter(isId);
    const rows = real.length
      ? await q
          .select({ id: tasks.id, number: tasks.number, key: projects.key })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(inArray(tasks.id, real))
      : [];
    const byId = new Map(rows.map((r) => [r.id, `${r.key}-${r.number}`]));
    return ids.map((id) => byId.get(id) ?? "?");
  }
  const rows = await q
    .select({ id: propertyOptions.id, name: propertyOptions.name })
    .from(propertyOptions)
    .where(inArray(propertyOptions.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return ids.map((id) => byId.get(id) ?? "?");
}

/** The options a new task starts with, by property id, for its `created`
    line: a chart counts a task made in a column as having entered it. */
export function optionsOf(
  values: Record<string, TaskValue>,
  props: Pick<PropertyRow, "id" | "type">[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of props) {
    if (!hasOptions(p.type)) continue;
    const v = values[p.id];
    const ids = (Array.isArray(v) ? v : [v]).filter(
      (x): x is string => typeof x === "string" && x !== "",
    );
    if (ids.length) out[p.id] = ids;
  }
  return out;
}

/** Human-readable text for one value. Used by the activity log. */
/** `q` is the transaction a caller is inside, so the read takes no second connection. */
export async function describeValue(
  prop: Pick<PropertyRow, "type">,
  value: TaskValue,
  q: Pick<typeof db, "select"> = db,
): Promise<string> {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return "empty";
  }
  if (hasOptions(prop.type)) {
    const ids = Array.isArray(value) ? value.map(String) : [String(value)];
    return (await namesOf(prop, ids, q)).join(", ");
  }
  if (prop.type === "checkbox") return value ? "on" : "off";
  /* The keys, which a person reads and an agent can open. */
  if (prop.type === "relation") {
    const ids = (Array.isArray(value) ? value : [value]).filter(isId);
    if (!ids.length) return "empty";
    return (await namesOf(prop, ids, q)).join(", ");
  }
  /* How many, never the addresses: the feed is read by everybody, and a list
     of URLs in one line reads as noise. */
  if (prop.type === "link") {
    const count = Array.isArray(value) ? value.length : 1;
    return count === 1 ? "1 link" : `${count} links`;
  }
  return String(value);
}
