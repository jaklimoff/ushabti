import { HttpError } from "@/lib/auth";
import { guard, json, route } from "@/lib/api";
import { loadActivityBefore, taskProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * The activity of a task older than `?before=<line id>`, sixty lines at a
 * time. The newest sixty come with the task, so this only continues that
 * list. It says nothing the task read does not, so `guard()` alone decides:
 * a member reads it, a person or an agent. Somebody outside the project is
 * told the task is not found, so a line id does not say a task exists.
 */
export const GET = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  await guard(projectId).catch((err: unknown) => {
    if (err instanceof HttpError && err.status === 403) throw new HttpError(404, "Task not found.");
    throw err;
  });
  const before = new URL(req.url).searchParams.get("before");
  if (before === null) throw new HttpError(400, "Name the line to read before, as ?before=.");
  return json(await loadActivityBefore(taskId, before));
});
