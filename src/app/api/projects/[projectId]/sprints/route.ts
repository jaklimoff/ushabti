import { eq } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { properties, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { adminOnly, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { defaultGroupById, withProjectLock } from "@/lib/queries";
import { rankAfter } from "@/lib/rank";
import { SPRINT, sprintsSetUp, sprintViews } from "@/lib/sprints";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Sets up sprints: the Sprint property, the Sprint board and the Backlog list.
 *
 * One transaction under the project lock, so a board never holds the property
 * without its views, and two presses at once cannot make two of each. The
 * second one reads the Sprint the first one wrote and is refused. It is
 * structure, so it is an admin's, and a person's.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  adminOnly(user, membership, "set up sprints");

  await withProjectLock(projectId, async (tx) => {
    const props = await tx
      .select({ name: properties.name, position: properties.position })
      .from(properties)
      .where(eq(properties.projectId, projectId))
      .orderBy(byPos(properties.position));
    if (sprintsSetUp(props)) throw new HttpError(409, "Sprints are set up.");

    const [sprint] = await tx
      .insert(properties)
      .values({
        projectId,
        name: SPRINT,
        type: "select",
        position: rankAfter(props.at(-1)?.position ?? null),
        // A sprint is an option with dates, so its boxes are there from the start.
        config: { dated: true },
      })
      .returning({ id: properties.id });

    const siblings = await tx
      .select({ position: views.position })
      .from(views)
      .where(eq(views.projectId, projectId))
      .orderBy(byPos(views.position));
    let position = siblings.at(-1)?.position ?? null;
    const groupById = await defaultGroupById(projectId, tx);

    for (const [at, view] of sprintViews(sprint.id, groupById).entries()) {
      position = rankAfter(position);
      await tx.insert(views).values({
        projectId,
        name: view.name,
        kind: view.kind,
        groupById: view.groupById,
        position,
        // A project with no view would have no main one, so the board takes it.
        isDefault: siblings.length === 0 && at === 0,
        config: { filters: view.filters },
      });
    }
  });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true }, 201);
});
