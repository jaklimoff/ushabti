import { and, eq } from "drizzle-orm";
import { viewLenses, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, humanOnly, json, route } from "@/lib/api";
import { clashOf, clashSaid, mergeFilters, readFilters } from "@/lib/filters";
import { loadProperties, viewProjectId, withProjectLock } from "@/lib/queries";
import { readLensSort } from "@/lib/sort";

type Ctx = { params: Promise<{ viewId: string }> };

/**
 * Puts one person's rules on the view, for everybody, and their order with
 * them.
 *
 * The rules go end to end, the view's first, exactly as a screen already reads
 * them — so the board this person was looking at is the board the team now
 * gets. The order goes with the rules: mine was winning over the view's on
 * this screen, so it is the one the team now gets, and a lens with no order
 * leaves the view's where it is. The lens is emptied in the same transaction: with the rules on the
 * view, keeping them twice would ask the same question twice and leave a
 * "Clear" that appeared to do nothing.
 *
 * Any member may press it. Writing a view's filters is a person's act, not an
 * agent's, which is what `humanOnly` says here as it does on the view route.
 *
 * It refuses, with 409 and one sentence, a lens that names a property the view
 * already filters: two rules about one property are a trap, and this hands
 * them to the whole team at once.
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
    const ofView = readFilters(config.filters, properties);
    const mine = readFilters(lens?.filters, properties);

    /* One property, one rule. The panel will not start a second rule about a
       property the view already filters, but a rule of mine becomes one the
       moment somebody else puts that property on the view — so the door the
       team comes through says it again, and nothing is written. */
    const clash = clashOf(ofView, mine, properties);
    if (clash) throw new HttpError(409, clashSaid(clash));

    const filters = mergeFilters(ofView, mine);
    const sort = readLensSort(lens?.filters, properties);

    await tx
      .update(views)
      .set({ config: { ...config, filters, ...(sort ? { sort } : {}) } })
      .where(eq(views.id, viewId));
    await tx
      .delete(viewLenses)
      .where(and(eq(viewLenses.userId, user.id), eq(viewLenses.viewId, viewId)));
  });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});
