import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskValues } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { dropHidden, lockTasks } from "@/lib/hidden";
import { taskProjectId } from "@/lib/queries";
import { coerceValue, describeValue, loadProperty, valueLine } from "@/lib/values";

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
  const value = await coerceValue(prop, input.value);
  const described = await describeValue(prop, value);

  /* The value and what it hides go together: a type changed in one
     statement and its hidden Done left for the next would be read between. */
  const { dropped, ring } = await db.transaction(async (tx) => {
    await lockTasks(tx, [taskId]);
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
          data: valueLine(prop, value, described),
        },
      ],
    });
  });
  await ring();
  await broadcast({ projectId, scope: "board", taskId, clientId: clientIdOf(req) });
  return json({ value, dropped });
});
