import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, taskValues, tasks } from "@/db/schema";
import { buildChangelog, publicChangelog, type Changelog, type PublicChangelog } from "./changelog";
import { loadProperties } from "./queries";

/**
 * The changelog of one project. Archived tasks are read with the live ones,
 * because a ship archives what it shipped; a deleted task was a mistake and
 * stays out.
 */
export async function loadChangelog(projectId: string): Promise<Changelog | null> {
  const [project] = await db
    .select({ id: projects.id, name: projects.name, key: projects.key })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return null;

  const [props, taskRows, valueRows] = await Promise.all([
    loadProperties(projectId),
    db
      .select({
        id: tasks.id,
        number: tasks.number,
        title: tasks.title,
        position: tasks.position,
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt))),
    db
      .select({
        taskId: taskValues.taskId,
        propertyId: taskValues.propertyId,
        value: taskValues.value,
      })
      .from(taskValues)
      .innerJoin(tasks, eq(tasks.id, taskValues.taskId))
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt))),
  ]);

  const values = new Map<string, Record<string, unknown>>();
  for (const v of valueRows) {
    const row = values.get(v.taskId) ?? {};
    row[v.propertyId] = v.value;
    values.set(v.taskId, row);
  }
  return buildChangelog({
    project,
    properties: props,
    tasks: taskRows.map((t) => ({ ...t, values: values.get(t.id) ?? {} })),
  });
}

/**
 * The public changelog at `/changelog/{slug}`. It answers only for the one
 * project with that key that turned it on; anything else is not found, so a
 * stranger cannot tell a private project from no project.
 */
export async function loadPublicChangelog(slug: string): Promise<PublicChangelog | null> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(sql`lower(${projects.key}) = ${slug.toLowerCase()}`, eq(projects.publicChangelog, true)),
    );
  if (!project) return null;
  const log = await loadChangelog(project.id);
  return log ? publicChangelog(log) : null;
}
