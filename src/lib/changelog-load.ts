import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { readShipped, shippedTasks } from "./changelog-read";
import { buildChangelog, publicChangelog, type Changelog, type PublicChangelog } from "./changelog";
import { loadProperties } from "./queries";
import { readReleaseBy } from "./releases";

/**
 * The changelog of one project. Archived tasks are read with the live ones,
 * because a ship archives what it shipped; a deleted task was a mistake and
 * stays out.
 *
 * With releases off there is no changelog, and both pages answer not found.
 * Off clears only the pointer, so on again brings the same entries back.
 */
export async function loadChangelog(projectId: string): Promise<Changelog | null> {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      key: projects.key,
      releaseBy: projects.releaseBy,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return null;

  const [props, shippedRows] = await Promise.all([
    loadProperties(projectId),
    readShipped(db, projectId),
  ]);
  const { releaseBy, ...named } = project;
  if (!readReleaseBy(releaseBy, props)) return null;
  return buildChangelog({ project: named, properties: props, tasks: shippedTasks(shippedRows) });
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
