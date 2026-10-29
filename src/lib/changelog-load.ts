import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { readShipped, shippedTasks } from "./changelog-read";
import {
  buildChangelog,
  newestShipped,
  publicChangelog,
  type Changelog,
  type PublicChangelog,
} from "./changelog";
import { changelogShelf } from "./changelog-shelf";
import { loadProperties } from "./queries";
import { readReleaseBy } from "./releases";

/**
 * The changelog of one project. Archived tasks are read with the live ones,
 * because a ship archives what it shipped; a deleted task was a mistake and
 * stays out.
 *
 * With releases off there is no changelog. The member's page says so, and the
 * public page answers not found. Off clears only the pointer, so on again
 * brings the same entries back.
 *
 * `shown` is how many of the newest releases to read; a page passes it, and
 * the route, which an agent reads release notes from, does not.
 */
export async function loadChangelog(
  projectId: string,
  shown = Infinity,
): Promise<Changelog | null> {
  const project = await changelogProject(projectId);
  if (!project) return null;

  const props = await loadProperties(projectId);
  const { releaseBy, ...named } = project;
  if (!readReleaseBy(releaseBy, props)) return null;
  const { properties, older } = newestShipped(props, shown);
  const optionIds = Number.isFinite(shown)
    ? properties.flatMap((p) => p.options.map((o) => o.id))
    : undefined;
  const rows = await readShipped(db, projectId, optionIds);
  return buildChangelog({ project: named, properties, tasks: shippedTasks(rows) }, older);
}

/** What the changelog's bar names, read whether releases are on or off. */
export async function changelogProject(projectId: string) {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      key: projects.key,
      color: projects.color,
      releaseBy: projects.releaseBy,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  return project ?? null;
}

/**
 * Whether strangers read this project's changelog. Its own read, so the
 * changelog's answer, which the route hands an agent, keeps its shape.
 */
export async function changelogIsPublic(projectId: string): Promise<boolean> {
  const [project] = await db
    .select({ publicChangelog: projects.publicChangelog })
    .from(projects)
    .where(eq(projects.id, projectId));
  return project?.publicChangelog ?? false;
}

/**
 * The public changelog at `/changelog/{slug}`. It answers only for the one
 * project with that key that turned it on; anything else is not found, so a
 * stranger cannot tell a private project from no project.
 *
 * Which project that is gets asked on every visit, so turning the page off
 * or changing the key is at once. What the page draws is kept between
 * visits; see `changelog-shelf.ts`.
 */
export async function loadPublicChangelog(
  slug: string,
  shown = Infinity,
): Promise<PublicChangelog | null> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(sql`lower(${projects.key}) = ${slug.toLowerCase()}`, eq(projects.publicChangelog, true)),
    );
  if (!project) return null;
  return changelogShelf<PublicChangelog | null>().get(project.id, shown, async () => {
    const log = await loadChangelog(project.id, shown);
    return log ? publicChangelog(log) : null;
  });
}
