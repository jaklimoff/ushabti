import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskValues } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { guard, json, route } from "@/lib/api";
import { countPropertyValues, loadRawProperties, propertyProjectId } from "@/lib/queries";
import type { TaskValue } from "@/lib/types";
import { readWhen, ruleDrops } from "@/lib/when";

type Ctx = { params: Promise<{ propertyId: string }> };

/**
 * How many tasks hold a value for this property, archived ones included.
 *
 * It is the number the delete row names, and it is asked when that row is
 * pressed. It used to ride on every board read, so the daily read paid for a
 * number the owner reads once a month.
 *
 * Any member may ask. Deleting the property is an admin's, but a count hands
 * out no access and says nothing a member cannot count off the board itself,
 * so an agent may call it too.
 *
 * Asked with `?when=` and a rule, it answers what that rule would take away
 * instead: how many tasks lose a value, and of which properties. Settings
 * names both before it writes the rule. The values of an archived task go
 * the same way, so they are counted too.
 */
export const GET = route<Ctx>(async (req, ctx) => {
  const { propertyId } = await ctx.params;
  const projectId = await propertyProjectId(propertyId);
  if (!projectId) throw new HttpError(404, "Property not found.");
  await guard(projectId);

  const raw = new URL(req.url).searchParams.get("when");
  if (raw === null) return json({ values: await countPropertyValues(propertyId) });

  let asked: unknown;
  try {
    asked = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "The rule must be JSON.");
  }
  /* Raw, so a rule a circle switches off is still there to come back on
     when this one breaks the circle; `ruleDrops` reads them all again. */
  const properties = await loadRawProperties(projectId);
  const when = readWhen(asked, properties, propertyId);
  const rows = await db
    .select({
      taskId: taskValues.taskId,
      propertyId: taskValues.propertyId,
      value: taskValues.value,
    })
    .from(taskValues)
    .innerJoin(tasks, eq(tasks.id, taskValues.taskId))
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
  const byTask = new Map<string, Record<string, TaskValue>>();
  for (const row of rows) {
    const values = byTask.get(row.taskId) ?? {};
    values[row.propertyId] = row.value as TaskValue;
    byTask.set(row.taskId, values);
  }
  const tasksOf = [...byTask.values()].map((values) => ({ values }));
  return json(ruleDrops(tasksOf, properties, propertyId, when));
});
