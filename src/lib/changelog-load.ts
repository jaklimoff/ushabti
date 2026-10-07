import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { readShipped, shippedTasks } from "./changelog-read";
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

  const [props, shippedRows] = await Promise.all([
    loadProperties(projectId),
    readShipped(db, projectId),
  ]);
  return buildChangelog({ project, properties: props, tasks: shippedTasks(shippedRows) });
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
