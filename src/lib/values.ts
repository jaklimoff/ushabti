import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, properties, propertyOptions, taskValues } from "@/db/schema";
import { HttpError } from "./auth";
import type { PropertyType, TaskValue } from "./types";

export type PropertyRow = {
  id: string;
  projectId: string;
  name: string;
  type: PropertyType;
};

export async function loadProperty(propertyId: string): Promise<PropertyRow> {
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
    return prop.type === "multi_select" ? [] : null;
  }

  switch (prop.type) {
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

/** Writes one value, replacing any earlier value for the same property. */
export async function putValue(taskId: string, propertyId: string, value: TaskValue) {
  await db
    .insert(taskValues)
    .values({ taskId, propertyId, value })
    .onConflictDoUpdate({
      target: [taskValues.taskId, taskValues.propertyId],
      set: { value },
    });
}

/** Human-readable text for one value. Used by the activity log. */
export async function describeValue(prop: PropertyRow, value: TaskValue): Promise<string> {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return "empty";
  }
  if (prop.type === "select" || prop.type === "multi_select") {
    const ids = Array.isArray(value) ? value : [String(value)];
    const rows = await db
      .select({ id: propertyOptions.id, name: propertyOptions.name })
      .from(propertyOptions)
      .where(inArray(propertyOptions.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r.name]));
    return ids.map((id) => byId.get(id) ?? "?").join(", ");
  }
  if (prop.type === "checkbox") return value ? "on" : "off";
  return String(value);
}
