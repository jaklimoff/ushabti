import { and, eq, ne, sql } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { db } from "@/db";
import { properties, propertyOptions, taskValues } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, adminOnly, route, str } from "@/lib/api";
import { optionPropertyId, withProjectLock } from "@/lib/queries";
import { rankBetween } from "@/lib/rank";
import { takenBy, takenSaid } from "@/lib/option-name";
import { datesClash, namesOptionDates, ONLY_SELECT, readOptionDates } from "@/lib/option-dates";

type Ctx = { params: Promise<{ optionId: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { optionId } = await ctx.params;
  const owner = await optionPropertyId(optionId);
  if (!owner) throw new HttpError(404, "Option not found.");
  await guard(owner.projectId);

  const input = await body<Record<string, unknown> & { afterId?: string | null }>(req);
  const patch: Record<string, unknown> = {};
  const dates = readOptionDates(input);
  if ("error" in dates) throw new HttpError(400, dates.error);
  Object.assign(patch, dates.patch);

  if (input.name !== undefined) patch.name = str(input.name, "Option name", { max: 40 });
  if (input.color !== undefined) {
    if (typeof input.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(input.color)) {
      throw new HttpError(400, "The colour must look like #3fb0c8.");
    }
    patch.color = input.color;
  }
  if (Object.keys(patch).length === 0 && input.afterId === undefined) return json({ ok: true });

  // A new name and a new place both read the other options first, so both
  // are written under the lock that every other option write takes.
  await withProjectLock(owner.projectId, async (tx) => {
    const siblings = await tx
      .select({
        id: propertyOptions.id,
        name: propertyOptions.name,
        position: propertyOptions.position,
      })
      .from(propertyOptions)
      .where(
        and(eq(propertyOptions.propertyId, owner.propertyId), ne(propertyOptions.id, optionId)),
      )
      .orderBy(byPos(propertyOptions.position));

    if (namesOptionDates(input)) {
      const [own] = await tx
        .select({
          type: properties.type,
          startAt: propertyOptions.startAt,
          targetAt: propertyOptions.targetAt,
        })
        .from(propertyOptions)
        .innerJoin(properties, eq(properties.id, propertyOptions.propertyId))
        .where(eq(propertyOptions.id, optionId))
        .limit(1);
      if (!own) throw new HttpError(404, "Option not found.");
      if (own.type !== "select") throw new HttpError(400, ONLY_SELECT);
      // A target moved alone is read against the start already saved.
      const clash = datesClash({
        startAt: dates.patch.startAt !== undefined ? dates.patch.startAt : own.startAt,
        targetAt: dates.patch.targetAt !== undefined ? dates.patch.targetAt : own.targetAt,
      });
      if (clash) throw new HttpError(400, clash);
    }

    if (typeof patch.name === "string") {
      const taken = takenBy(siblings, patch.name);
      if (taken) {
        const [prop] = await tx
          .select({ name: properties.name })
          .from(properties)
          .where(eq(properties.id, owner.propertyId))
          .limit(1);
        throw new HttpError(409, takenSaid(prop.name, taken.name));
      }
    }

    if (input.afterId !== undefined) {
      const index = input.afterId ? siblings.findIndex((s) => s.id === input.afterId) : -1;
      const before = index >= 0 ? siblings[index].position : null;
      const after = siblings[index + 1]?.position ?? null;
      patch.position = rankBetween(before, after);
    }

    await tx.update(propertyOptions).set(patch).where(eq(propertyOptions.id, optionId));
  });

  await broadcast({ projectId: owner.projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { optionId } = await ctx.params;
  const owner = await optionPropertyId(optionId);
  if (!owner) throw new HttpError(404, "Option not found.");
  const { user, membership } = await guard(owner.projectId);
  adminOnly(user, membership, "delete an option");

  // Tasks that hold this option lose the value. Single-select clears, and
  // multi-select drops the one entry.
  await db
    .update(taskValues)
    .set({ value: null })
    .where(
      and(
        eq(taskValues.propertyId, owner.propertyId),
        sql`${taskValues.value} = ${JSON.stringify(optionId)}::jsonb`,
      ),
    );
  await db
    .update(taskValues)
    .set({
      value: sql`(select coalesce(jsonb_agg(elem), '[]'::jsonb) from jsonb_array_elements(${taskValues.value}) elem where elem <> ${JSON.stringify(optionId)}::jsonb)`,
    })
    .where(
      and(
        eq(taskValues.propertyId, owner.propertyId),
        sql`jsonb_typeof(${taskValues.value}) = 'array'`,
        sql`${taskValues.value} @> ${JSON.stringify([optionId])}::jsonb`,
      ),
    );

  await db.delete(propertyOptions).where(eq(propertyOptions.id, optionId));
  await broadcast({ projectId: owner.projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});
