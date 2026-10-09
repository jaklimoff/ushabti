import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, properties, propertyOptions } from "@/db/schema";
import { readId } from "./api";
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

/** Checks a raw value against the property type and returns what to store. */
export async function coerceValue(prop: PropertyRow, raw: unknown): Promise<TaskValue> {
  if (raw === null || raw === undefined || raw === "") {
    return prop.type === "multi_select" || prop.type === "link" ? [] : null;
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
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
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
    default:
      throw new HttpError(400, "Unknown property type.");
  }
}

async function assertOptions(propertyId: string, ids: string[]) {
  const rows = await db
    .select({ id: propertyOptions.id })
    .from(propertyOptions)
    .where(and(eq(propertyOptions.propertyId, propertyId), inArray(propertyOptions.id, ids)));
  if (rows.length !== new Set(ids).size) {
    throw new HttpError(400, "One of the options does not exist any more.");
  }
}

/** The data of a value line. The name is for people; the id and the type
    are for an agent, since a name can change. A person line names the
    person too, so a watcher can tell whether it is for it without reading
    the board. Fields are only ever added here: old watchers read the rest. */
export function valueLine(
  prop: Pick<PropertyRow, "id" | "name" | "type">,
  value: TaskValue,
  described: string,
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
  return line;
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
  prop: PropertyRow,
  value: TaskValue,
  q: Pick<typeof db, "select"> = db,
): Promise<string> {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return "empty";
  }
  if (hasOptions(prop.type)) {
    const ids = Array.isArray(value) ? value : [String(value)];
    const rows = await q
      .select({ id: propertyOptions.id, name: propertyOptions.name })
      .from(propertyOptions)
      .where(inArray(propertyOptions.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r.name]));
    return ids.map((id) => byId.get(id) ?? "?").join(", ");
  }
  if (prop.type === "checkbox") return value ? "on" : "off";
  /* How many, never the addresses: the feed is read by everybody, and a list
     of URLs in one line reads as noise. */
  if (prop.type === "link") {
    const count = Array.isArray(value) ? value.length : 1;
    return count === 1 ? "1 link" : `${count} links`;
  }
  return String(value);
}
