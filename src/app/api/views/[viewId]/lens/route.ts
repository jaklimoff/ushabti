import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { viewLenses } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, guard, humanOnly, json, route } from "@/lib/api";
import { readFilters } from "@/lib/filters";
import { loadProperties, viewProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ viewId: string }> };

/**
 * The rules this person added to this view. Nobody else reads them.
 *
 * Nothing is broadcast. A lens changes one screen, so telling the project
 * about it would wake every other browser to fetch a board that has not
 * moved — and the stream is for what the team shares.
 *
 * An empty set removes the row rather than saving an empty one, so a person
 * who cleared their filter leaves nothing behind.
 */
export const PUT = route<Ctx>(async (req, ctx) => {
  const { viewId } = await ctx.params;
  const projectId = await viewProjectId(viewId);
  if (!projectId) throw new HttpError(404, "View not found.");
  const { user } = await guard(projectId);
  // Only a person has a screen of their own to narrow.
  humanOnly(user);

  const input = await body<{ filters?: unknown }>(req);
  const properties = await loadProperties(projectId);
  // The same reading the board does, so a rule this cannot make sense of is
  // dropped here rather than saved and ignored for ever afterwards.
  const filters = readFilters(input.filters, properties);

  if (filters.rules.length === 0) {
    await db
      .delete(viewLenses)
      .where(and(eq(viewLenses.userId, user.id), eq(viewLenses.viewId, viewId)));
    return json({ ok: true });
  }

  await db
    .insert(viewLenses)
    .values({ userId: user.id, viewId, filters })
    .onConflictDoUpdate({
      target: [viewLenses.userId, viewLenses.viewId],
      set: { filters, updatedAt: new Date() },
    });

  return json({ ok: true });
});
