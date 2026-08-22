import { eq } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { db } from "@/db";
import { properties, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route, str } from "@/lib/api";
import { withProjectLock } from "@/lib/queries";
import { rankAfter } from "@/lib/rank";
import { GROUPABLE_TYPES, type PropertyType } from "@/lib/types";

type Ctx = { params: Promise<{ projectId: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  await guard(projectId);

  const input = await body<{ name?: string; groupById?: string }>(req);
  const name = str(input.name, "View name", { max: 40 });
  if (typeof input.groupById !== "string")
    throw new HttpError(400, "Choose a property to group by.");

  const [prop] = await db
    .select({ id: properties.id, type: properties.type, projectId: properties.projectId })
    .from(properties)
    .where(eq(properties.id, input.groupById))
    .limit(1);
  if (!prop || prop.projectId !== projectId)
    throw new HttpError(400, "That property is not in this project.");
  if (!GROUPABLE_TYPES.includes(prop.type as PropertyType)) {
    throw new HttpError(400, "A board can only group by a select, person or checkbox property.");
  }

  const view = await withProjectLock(projectId, async (tx) => {
    const siblings = await tx
      .select({ position: views.position })
      .from(views)
      .where(eq(views.projectId, projectId))
      .orderBy(byPos(views.position));

    const [row] = await tx
      .insert(views)
      .values({
        projectId,
        name,
        groupById: prop.id,
        position: rankAfter(siblings.at(-1)?.position ?? null),
        isDefault: siblings.length === 0,
        config: {},
      })
      .returning();
    return row;
  });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ view }, 201);
});
