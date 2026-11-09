import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskValues } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { logActivityIn } from "@/lib/activity";
import { lockTasks } from "@/lib/hidden";
import { taskProjectId } from "@/lib/queries";
import { describeValue, loadProperty, valueLine } from "@/lib/values";
import type { TaskValue } from "@/lib/types";

type Ctx = { params: Promise<{ taskId: string; propertyId: string; pointedId: string }> };

/**
 * Takes one task off a Tasks value, from the side it points at. The panel of
 * that task knows only that this task names it, not the rest of the list, so
 * the list is read and written here, under the task's lock: a value put
 * whole from the panel would undo a pick made in between, and would drop a
 * deleted task the value still names, which comes back on restore.
 */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const { taskId, propertyId, pointedId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const prop = await loadProperty(propertyId);
  if (prop.projectId !== projectId) {
    throw new HttpError(400, "That property is not in this project.");
  }
  if (prop.type !== "relation") throw new HttpError(400, `${prop.name} does not hold tasks.`);

  const result = await db.transaction(async (tx) => {
    await lockTasks(tx, [taskId]);
    const [row] = await tx
      .select({ value: taskValues.value })
      .from(taskValues)
      .where(and(eq(taskValues.taskId, taskId), eq(taskValues.propertyId, propertyId)));
    const held = Array.isArray(row?.value) ? (row.value as unknown[]) : [];
    if (!held.includes(pointedId)) return null;
    const value: TaskValue = held.filter(
      (id): id is string => typeof id === "string" && id !== pointedId,
    );
    await tx
      .update(taskValues)
      .set({ value })
      .where(and(eq(taskValues.taskId, taskId), eq(taskValues.propertyId, propertyId)));
    await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, taskId));
    const described = await describeValue(prop, value, tx);
    const ring = await logActivityIn(tx, [
      {
        projectId,
        taskId,
        actorId: user.id,
        kind: "value",
        data: valueLine(prop, value, described),
      },
    ]);
    return { value, ring };
  });

  /* Already off is what was asked for, so it answers as a write would. */
  if (!result) return json({ value: null, changed: false });
  await result.ring();
  await broadcast({ projectId, scope: "board", taskId, clientId: clientIdOf(req) });
  return json({ value: result.value, changed: true });
});
