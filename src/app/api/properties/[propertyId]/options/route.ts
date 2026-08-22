import { eq } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { db } from "@/db";
import { properties, propertyOptions } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route, str } from "@/lib/api";
import { propertyProjectId, withProjectLock } from "@/lib/queries";
import { nextPaletteColor } from "@/lib/colors";
import { rankAfter } from "@/lib/rank";

type Ctx = { params: Promise<{ propertyId: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const { propertyId } = await ctx.params;
  const projectId = await propertyProjectId(propertyId);
  if (!projectId) throw new HttpError(404, "Property not found.");
  await guard(projectId);

  const [prop] = await db
    .select({ type: properties.type })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  if (prop.type !== "select" && prop.type !== "multi_select") {
    throw new HttpError(400, "Only select properties have options.");
  }

  const input = await body<{ name?: string; color?: string }>(req);
  const name = str(input.name, "Option name", { max: 40 });

  const option = await withProjectLock(projectId, async (tx) => {
    const siblings = await tx
      .select({ color: propertyOptions.color, position: propertyOptions.position })
      .from(propertyOptions)
      .where(eq(propertyOptions.propertyId, propertyId))
      .orderBy(byPos(propertyOptions.position));

    const color =
      typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color)
        ? input.color
        : nextPaletteColor(siblings.map((s) => s.color));

    const [row] = await tx
      .insert(propertyOptions)
      .values({
        propertyId,
        name,
        color,
        position: rankAfter(siblings.at(-1)?.position ?? null),
      })
      .returning();
    return row;
  });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ option }, 201);
});
