import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { body, broadcast, clientIdOf, guard, humanOnly, json, route } from "@/lib/api";
import { readCardView } from "@/lib/card-view";
import { defaultGroupById, loadProperties } from "@/lib/queries";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Arranges the card every board of this project draws.
 *
 * A person does this, not an agent: the card view is the shape of the board
 * rather than anything on it, and an agent that lost its token would otherwise
 * take the board apart. Any member may arrange it, because everybody has to
 * read the result.
 *
 * The body carries the whole card view, or null to go back to the default. It
 * goes through `readCardView` before it is stored, so what lands in the row is
 * already true: the title has not moved, one row holds the edge, and no row
 * names a property that is gone.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);
  humanOnly(user);

  const input = await body<{ cardView?: unknown }>(req);

  if (input.cardView === null) {
    await db.update(projects).set({ cardView: null }).where(eq(projects.id, projectId));
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
    return json({ ok: true });
  }

  const [properties, groupById] = await Promise.all([
    loadProperties(projectId),
    defaultGroupById(projectId),
  ]);
  const cardView = readCardView(input.cardView, properties, groupById);

  await db.update(projects).set({ cardView }).where(eq(projects.id, projectId));
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ cardView });
});
