import { eq } from "drizzle-orm";
import { db } from "@/db";
import { properties, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, ownerOnly, route, str } from "@/lib/api";
import { viewProjectId } from "@/lib/queries";
import { GROUPABLE_TYPES, type PropertyType } from "@/lib/types";

type Ctx = { params: Promise<{ viewId: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { viewId } = await ctx.params;
  const projectId = await viewProjectId(viewId);
  if (!projectId) throw new HttpError(404, "View not found.");
  await guard(projectId);

  const input = await body<{ name?: string; groupById?: string }>(req);
  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) patch.name = str(input.name, "View name", { max: 40 });
  if (input.groupById !== undefined) {
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
    patch.groupById = prop.id;
  }

  if (Object.keys(patch).length === 0) return json({ ok: true });
  await db.update(views).set(patch).where(eq(views.id, viewId));
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { viewId } = await ctx.params;
  const projectId = await viewProjectId(viewId);
  if (!projectId) throw new HttpError(404, "View not found.");
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "delete a view");

  const [view] = await db.select().from(views).where(eq(views.id, viewId)).limit(1);
  if (view.isDefault) throw new HttpError(400, "The main view cannot be deleted.");

  await db.delete(views).where(eq(views.id, viewId));
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});
