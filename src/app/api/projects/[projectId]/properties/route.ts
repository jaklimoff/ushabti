import { eq } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { db } from "@/db";
import { properties, propertyOptions } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route, str } from "@/lib/api";
import { withProjectLock } from "@/lib/queries";
import { rankAfter, rankSequence } from "@/lib/rank";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/types";
import { PALETTE } from "@/lib/colors";

type Ctx = { params: Promise<{ projectId: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  await guard(projectId);

  const input = await body<{ name?: string; type?: string; options?: string[] }>(req);
  const name = str(input.name, "Property name", { max: 40 });
  const type = input.type as PropertyType;
  if (!PROPERTY_TYPES.includes(type))
    throw new HttpError(400, "That property type does not exist.");

  const prop = await withProjectLock(projectId, async (tx) => {
    const last = await tx
      .select({ position: properties.position })
      .from(properties)
      .where(eq(properties.projectId, projectId))
      .orderBy(byPos(properties.position));

    const [row] = await tx
      .insert(properties)
      .values({
        projectId,
        name,
        type,
        position: rankAfter(last.at(-1)?.position ?? null),
        config: {},
      })
      .returning();
    return row;
  });

  let options: { id: string; name: string; color: string; position: string }[] = [];
  if ((type === "select" || type === "multi_select") && Array.isArray(input.options)) {
    const names = input.options
      .map((o) => (typeof o === "string" ? o.trim() : ""))
      .filter(Boolean)
      .slice(0, 40);
    if (names.length) {
      const ranks = rankSequence(names.length);
      options = await db
        .insert(propertyOptions)
        .values(
          names.map((n, i) => ({
            propertyId: prop.id,
            name: n,
            color: PALETTE[i % PALETTE.length],
            position: ranks[i],
          })),
        )
        .returning({
          id: propertyOptions.id,
          name: propertyOptions.name,
          color: propertyOptions.color,
          position: propertyOptions.position,
        });
    }
  }

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ property: { ...prop, options } }, 201);
});
