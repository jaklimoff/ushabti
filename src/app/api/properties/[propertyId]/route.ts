import { eq, ne, and } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { db } from "@/db";
import { properties, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, ownerOnly, route, str } from "@/lib/api";
import { propertyProjectId, withProjectLock } from "@/lib/queries";
import { rankBetween } from "@/lib/rank";

type Ctx = { params: Promise<{ propertyId: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { propertyId } = await ctx.params;
  const projectId = await propertyProjectId(propertyId);
  if (!projectId) throw new HttpError(404, "Property not found.");
  await guard(projectId);

  const input = await body<{ name?: string; showOnCard?: boolean; afterId?: string | null }>(req);
  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) patch.name = str(input.name, "Property name", { max: 40 });

  if (input.showOnCard !== undefined) {
    const [current] = await db
      .select({ config: properties.config })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);
    patch.config = { ...((current?.config ?? {}) as object), showOnCard: !!input.showOnCard };
  }

  if (input.afterId !== undefined) {
    await withProjectLock(projectId, async (tx) => {
      const siblings = await tx
        .select({ id: properties.id, position: properties.position })
        .from(properties)
        .where(and(eq(properties.projectId, projectId), ne(properties.id, propertyId)))
        .orderBy(byPos(properties.position));
      const index = input.afterId ? siblings.findIndex((s) => s.id === input.afterId) : -1;
      const before = index >= 0 ? siblings[index].position : null;
      const after = siblings[index + 1]?.position ?? null;
      await tx
        .update(properties)
        .set({ ...patch, position: rankBetween(before, after) })
        .where(eq(properties.id, propertyId));
    });
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
    return json({ ok: true });
  }

  if (Object.keys(patch).length === 0) return json({ ok: true });

  await db.update(properties).set(patch).where(eq(properties.id, propertyId));
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { propertyId } = await ctx.params;
  const projectId = await propertyProjectId(propertyId);
  if (!projectId) throw new HttpError(404, "Property not found.");
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "delete a property");

  // A view is meaningless without its grouping property, so deleting the
  // property would take the view with it. Say so instead of doing it quietly.
  const used = await db
    .select({ name: views.name })
    .from(views)
    .where(and(eq(views.projectId, projectId), eq(views.groupById, propertyId)));
  if (used.length) {
    const names = used.map((v) => `"${v.name}"`).join(", ");
    throw new HttpError(
      400,
      used.length === 1
        ? `The view ${names} groups by this property. Point it at another property first.`
        : `These views group by this property: ${names}. Point them at another property first.`,
    );
  }

  await db.delete(properties).where(eq(properties.id, propertyId));
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});
