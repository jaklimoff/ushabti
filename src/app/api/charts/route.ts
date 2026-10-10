import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { charts, properties, propertyOptions } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, guard, humanOnly, json, readId, route } from "@/lib/api";
import { CHART_TWICE } from "@/lib/charts";
import { chartsOf } from "@/lib/charts-load";
import { lockList } from "@/lib/membership";
import { rankAfter } from "@/lib/rank";
import { isSelect } from "@/lib/types";

/** A new chart on Home: one option of one select in a project the person is in. */
export const POST = route(async (req) => {
  const input = await body<{ projectId?: unknown; propertyId?: unknown; optionId?: unknown }>(req);
  const { user } = await guard(String(input.projectId ?? ""));
  humanOnly(user);
  const projectId = String(input.projectId);
  const propertyId = readId(input.propertyId, "property");
  const optionId = readId(input.optionId, "option");
  const [property] = await db
    .select({ type: properties.type })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.projectId, projectId)))
    .limit(1);
  if (!property || !isSelect(property.type)) {
    throw new HttpError(400, "A chart counts the options of a select.");
  }
  const [option] = await db
    .select({ id: propertyOptions.id })
    .from(propertyOptions)
    .where(and(eq(propertyOptions.id, optionId), eq(propertyOptions.propertyId, propertyId)))
    .limit(1);
  if (!option) throw new HttpError(400, "That option does not exist any more.");
  // Under the person's own lock, so two presses cannot both find no twin.
  const chart = await db.transaction(async (tx) => {
    await lockList(tx, user.id);
    const rows = await chartsOf(user.id, tx);
    const twin = rows.some(
      (r) => r.projectId === projectId && r.propertyId === propertyId && r.optionId === optionId,
    );
    if (twin) throw new HttpError(409, CHART_TWICE);
    const [made] = await tx
      .insert(charts)
      .values({
        userId: user.id,
        projectId,
        propertyId,
        optionId,
        position: rankAfter(rows.at(-1)?.position),
      })
      .returning({ id: charts.id });
    return made;
  });
  return json({ chart }, 201);
});
