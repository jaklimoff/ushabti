import { and, eq } from "drizzle-orm";
import { viewLenses, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, humanOnly, json, route } from "@/lib/api";
import { mergeFilters, readFilters } from "@/lib/filters";
import { loadProperties, viewProjectId, withProjectLock } from "@/lib/queries";

type Ctx = { params: Promise<{ viewId: string }> };

/**
 * Puts one person's rules on the view, for everybody.
 *
 * The rules go end to end, the view's first, exactly as a screen already reads
 * them — so the board this person was looking at is the board the team now
 * gets. The lens is emptied in the same transaction: with the rules on the
 * view, keeping them twice would ask the same question twice and leave a
 * "Clear" that appeared to do nothing.
 *
 * Any member may press it. Writing a view's filters is a person's act, not an
 * agent's, which is what `humanOnly` says here as it does on the view route.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { viewId } = await ctx.params;
  const projectId = await viewProjectId(viewId);
  if (!projectId) throw new HttpError(404, "View not found.");
  const { user } = await guard(projectId);
  humanOnly(user);

  const properties = await loadProperties(projectId);

  /* The read and the write are one step: two people promoting at the same
     moment would otherwise each append to the view they read, and the second
     write would lose the first person's rules. */
  await withProjectLock(projectId, async (tx) => {
    const [view] = await tx.select().from(views).where(eq(views.id, viewId)).limit(1);
    if (!view) throw new HttpError(404, "View not found.");

    const [lens] = await tx
      .select({ filters: viewLenses.filters })
      .from(viewLenses)
      .where(and(eq(viewLenses.userId, user.id), eq(viewLenses.viewId, viewId)))
      .limit(1);

    const config = (view.config ?? {}) as { filters?: unknown };
    const filters = mergeFilters(
      readFilters(config.filters, properties),
      readFilters(lens?.filters, properties),
    );

    await tx
      .update(views)
      .set({ config: { ...config, filters } })
      .where(eq(views.id, viewId));
    await tx
      .delete(viewLenses)
      .where(and(eq(viewLenses.userId, user.id), eq(viewLenses.viewId, viewId)));
  });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});
