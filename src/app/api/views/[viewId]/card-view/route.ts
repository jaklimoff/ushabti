import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { viewLenses, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, humanOnly, json, readId, route } from "@/lib/api";
import { ownCardView } from "@/lib/card-view";
import { loadProperties, toViewDTO } from "@/lib/queries";

type Ctx = { params: Promise<{ viewId: string }> };

/**
 * Arranges the card one view draws, beside the project's route and under the
 * same rule: a person may, an agent may not, and any member may, because
 * everybody reads the result.
 *
 * The body is the project route's: the whole card view, or null to throw the
 * copy away and draw the project's again. It goes through `readCardView`
 * before it is stored, so what lands in the row is already true. A body with
 * no rows is refused: it would store a default nobody arranged.
 *
 * It answers the view, so the screen that wrote it draws what was stored.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { viewId } = await ctx.params;
  readId(viewId, "view");
  const [view] = await db
    .select({ projectId: views.projectId })
    .from(views)
    .where(eq(views.id, viewId))
    .limit(1);
  if (!view) throw new HttpError(404, "View not found.");
  const { projectId } = view;
  const { user } = await guard(projectId);
  humanOnly(user);

  const input = await body<{ cardView?: unknown }>(req);
  if (input.cardView === undefined) throw new HttpError(400, "Send a card view, or null.");

  const properties = await loadProperties(projectId);
  /* A copy must say where its rows sit. A body with none would be stored as
     a default that was never asked for, so it is refused rather than read. */
  const cardView = input.cardView === null ? null : ownCardView(input.cardView, properties);
  if (input.cardView !== null && !cardView) throw new HttpError(400, "A card view has rows.");

  const [row] = await db.update(views).set({ cardView }).where(eq(views.id, viewId)).returning();
  if (!row) throw new HttpError(404, "View not found.");
  const [lens] = await db
    .select({ filters: viewLenses.filters })
    .from(viewLenses)
    .where(and(eq(viewLenses.userId, user.id), eq(viewLenses.viewId, viewId)))
    .limit(1);

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ view: toViewDTO(row, properties, lens?.filters) });
});
