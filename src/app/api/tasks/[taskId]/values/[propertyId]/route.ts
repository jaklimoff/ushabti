import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskValues } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { dropHidden, lockTasks } from "@/lib/hidden";
import { taskProjectId } from "@/lib/queries";
import { changeLine, coerceValue, loadProperty } from "@/lib/values";
import type { TaskValue } from "@/lib/types";

type Ctx = { params: Promise<{ taskId: string; propertyId: string }> };

export const PUT = route<Ctx>(async (req, ctx) => {
  const { taskId, propertyId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const prop = await loadProperty(propertyId);
  if (prop.projectId !== projectId)
    throw new HttpError(400, "That property is not in this project.");

  const input = await body<{ value?: unknown }>(req);
  const value = await coerceValue(prop, input.value, [taskId]);
  /* The value and what it hides go together: a type changed in one
     statement and its hidden Done left for the next would be read between. */
  const { dropped, ring } = await db.transaction(async (tx) => {
    await lockTasks(tx, [taskId]);
    /* What it was, read under the lock, so the line says what this write replaced. */
    const [had] = await tx
      .select({ value: taskValues.value })
      .from(taskValues)
      .where(and(eq(taskValues.taskId, taskId), eq(taskValues.propertyId, propertyId)));
    const data = await changeLine(prop, had?.value as TaskValue | undefined, value, tx);
    await tx
      .insert(taskValues)
      .values({ taskId, propertyId, value })
      .onConflictDoUpdate({
        target: [taskValues.taskId, taskValues.propertyId],
        set: { value },
      });
    await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, taskId));
    return dropHidden(tx, {
      projectId,
      taskIds: [taskId],
      actorId: user.id,
      before: [
        {
          projectId,
          taskId,
          actorId: user.id,
          kind: "value",
          data,
        },
      ],
    });
  });
  await ring();
  /* A Tasks value can name a task it did not name before, whose open panel
     lists who points at it: a ring that names only this task would pass it by. */
  await broadcast({
    projectId,
    scope: "board",
    ...(prop.type === "relation" ? {} : { taskId }),
    clientId: clientIdOf(req),
  });
  return json({ value, dropped });
});
