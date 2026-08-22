import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { logActivity, taskProjectId } from "@/lib/queries";
import { coerceValue, describeValue, loadProperty, putValue } from "@/lib/values";

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

  await putValue(taskId, propertyId, value);
  await db.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, taskId));
  await logActivity({
    projectId,
    taskId,
    actorId: user.id,
    kind: "value",
    data: { property: prop.name, value: await describeValue(prop, value) },
  });
  await broadcast({ projectId, scope: "board", taskId, clientId: clientIdOf(req) });
  return json({ value });
});
