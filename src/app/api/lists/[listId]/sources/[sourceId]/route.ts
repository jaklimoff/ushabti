import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { listSources } from "@/db/schema";
import { body, json, readId, route } from "@/lib/api";
import { HttpError, requireMembership } from "@/lib/auth";
import { readFilters } from "@/lib/filters";
import { ownList } from "@/lib/lists-load";
import { loadProperties } from "@/lib/queries";

type Ctx = { params: Promise<{ listId: string; sourceId: string }> };

async function ownSource(ctx: Ctx) {
  const { listId, sourceId } = await ctx.params;
  const { user, list } = await ownList(listId);
  readId(sourceId, "source");
  const [source] = await db
    .select()
    .from(listSources)
    .where(and(eq(listSources.id, sourceId), eq(listSources.listId, list.id)))
    .limit(1);
  if (!source) throw new HttpError(404, "Source not found.");
  return { user, source };
}

/**
 * The rules of one source. They are read against the project as a view's
 * are, so a rule this cannot make sense of is dropped here rather than kept.
 * A source of a project the person left cannot be changed: they cannot see
 * its properties.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { user, source } = await ownSource(ctx);
  await requireMembership(user.id, source.projectId);
  const input = await body<{ filters?: unknown }>(req);
  const filters = readFilters(input.filters, await loadProperties(source.projectId));
  await db.update(listSources).set({ filters }).where(eq(listSources.id, source.id));
  return json({ source: { id: source.id, projectId: source.projectId, filters } });
});

/** The project leaves the list. Its tasks stay where they are. */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const { source } = await ownSource(ctx);
  await db.delete(listSources).where(eq(listSources.id, source.id));
  return json({ ok: true });
});
