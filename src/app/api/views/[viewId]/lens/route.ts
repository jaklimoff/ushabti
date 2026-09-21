import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { viewLenses, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, guard, humanOnly, json, readId, route } from "@/lib/api";
import { clashOf, clashSaid, readFilters } from "@/lib/filters";
import { loadProperties } from "@/lib/queries";

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
 *
 * It refuses, with 409 and the sentence the promote route says, a rule about a
 * property the view already filters. The panel will not start such a rule, but
 * this route is the other way in, and a lens written past it would narrow this
 * screen with two chips that fight each other until somebody promoted it.
 */
export const PUT = route<Ctx>(async (req, ctx) => {
  const { viewId } = await ctx.params;
  /* One read answers both questions this route asks of the view: which project
     guards it, and what it already filters. It asked for the same row twice,
     and the panel writes on every rule a person changes. So the id is read
     here rather than by `viewProjectId`, which this route does not call. */
  readId(viewId, "view");
  const [view] = await db
    .select({ projectId: views.projectId, config: views.config })
    .from(views)
    .where(eq(views.id, viewId))
    .limit(1);
  if (!view) throw new HttpError(404, "View not found.");
  const { user } = await guard(view.projectId);
  // Only a person has a screen of their own to narrow.
  humanOnly(user);

  const input = await body<{ filters?: unknown }>(req);
  const properties = await loadProperties(view.projectId);
  // The same reading the board does, so a rule this cannot make sense of is
  // dropped here rather than saved and ignored for ever afterwards.
  const filters = readFilters(input.filters, properties);

  /* One property, one rule, whoever asked. The view's rules are read afresh
     here too, so what this compares against is what the screen shows.
     No lock: a rule that becomes a clash a moment later is what the promote
     route exists to catch, and a lens hides nothing from anybody else. */
  const ofView = readFilters((view.config as { filters?: unknown } | null)?.filters, properties);
  const clash = clashOf(ofView, filters, properties);
  if (clash) throw new HttpError(409, clashSaid(clash));

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
