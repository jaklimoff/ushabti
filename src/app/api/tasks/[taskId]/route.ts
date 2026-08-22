import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, optionalStr, route, str } from "@/lib/api";
import { loadTaskDetail, logActivity, taskProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ taskId: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  await guard(projectId);
  return json({ task: await loadTaskDetail(taskId) });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const input = await body<{ title?: string; description?: string }>(req);
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (input.title !== undefined) patch.title = str(input.title, "Title", { max: 400 });
  if (input.description !== undefined)
    patch.description = optionalStr(input.description, "Description") ?? "";

  await db.update(tasks).set(patch).where(eq(tasks.id, taskId));

  if (input.title !== undefined) {
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "title",
      data: { title: patch.title },
    });
  }
  if (input.description !== undefined) {
    await logActivity({ projectId, taskId, actorId: user.id, kind: "description", data: {} });
  }

  await broadcast({ projectId, scope: "task", taskId, clientId: clientIdOf(req) });
  return json({ ok: true });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const [row] = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  await db.delete(tasks).where(eq(tasks.id, taskId));
  await logActivity({
    projectId,
    actorId: user.id,
    kind: "deleted",
    data: { title: row?.title ?? "" },
  });
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});
