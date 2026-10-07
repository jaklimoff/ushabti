import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { properties, propertyOptions, taskValues, tasks } from "../db/schema";
import { isRelease, type ChangelogInput } from "./changelog";
import { PROPERTY_TYPES } from "./types";

/* Imports no `@/db` and no `server-only`, so a test can hand it a client of
   its own and hold it against a read of every task. */

export type ShippedRow = {
  id: string;
  number: number;
  title: string;
  position: string;
  propertyId: string;
  value: unknown;
};

/**
 * The tasks of one project that carry a shipped option, one row per task and
 * property. The public page asks this on every anonymous request, so it reads
 * only what `buildChangelog` keeps. Archived tasks stay in, because a ship
 * archives what it shipped.
 */
export function readShipped(
  db: Pick<NodePgDatabase<Record<string, unknown>>, "select">,
  projectId: string,
): Promise<ShippedRow[]> {
  return db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      position: tasks.position,
      propertyId: taskValues.propertyId,
      value: taskValues.value,
    })
    .from(taskValues)
    .innerJoin(tasks, eq(tasks.id, taskValues.taskId))
    .innerJoin(properties, eq(properties.id, taskValues.propertyId))
    .innerJoin(
      propertyOptions,
      and(
        eq(propertyOptions.propertyId, properties.id),
        /* Compared as jsonb, so a value that is not an id never reaches a cast. */
        sql`${taskValues.value} = to_jsonb(${propertyOptions.id}::text)`,
      ),
    )
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNull(tasks.deletedAt),
        eq(properties.projectId, projectId),
        /* A closed sprint is not a release, so it lists nothing. */
        inArray(properties.type, PROPERTY_TYPES.filter(isRelease)),
        isNotNull(propertyOptions.shippedAt),
      ),
    );
}

/** The rows of `readShipped` as the tasks `buildChangelog` takes. */
export function shippedTasks(rows: ShippedRow[]): ChangelogInput["tasks"] {
  const byId = new Map<string, ChangelogInput["tasks"][number]>();
  for (const r of rows) {
    const task = byId.get(r.id) ?? {
      id: r.id,
      number: r.number,
      title: r.title,
      position: r.position,
      values: {},
    };
    task.values[r.propertyId] = r.value;
    byId.set(r.id, task);
  }
  return [...byId.values()];
}
