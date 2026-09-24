import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskValues } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { guard, json, route } from "@/lib/api";
import { optionPropertyId } from "@/lib/queries";

type Ctx = { params: Promise<{ optionId: string }> };

/**
 * How many tasks hold this option, archived ones included, because the delete
 * clears it from them too. A single select holds the id, a multi-select holds
 * it in a list.
 *
 * It is the number the delete row names, asked when that row is pressed, as
 * the property count is. Any member may ask: a count hands out no access.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { optionId } = await ctx.params;
  const owner = await optionPropertyId(optionId);
  if (!owner) throw new HttpError(404, "Option not found.");
  await guard(owner.projectId);

  const id = JSON.stringify(optionId);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taskValues)
    .innerJoin(tasks, eq(tasks.id, taskValues.taskId))
    .where(
      and(
        eq(taskValues.propertyId, owner.propertyId),
        isNull(tasks.deletedAt),
        sql`(${taskValues.value} = ${id}::jsonb
             or (jsonb_typeof(${taskValues.value}) = 'array'
                 and ${taskValues.value} @> ${`[${id}]`}::jsonb))`,
      ),
    );
  return json({ tasks: row?.count ?? 0 });
});
