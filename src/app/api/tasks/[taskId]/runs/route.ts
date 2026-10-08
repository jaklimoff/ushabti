import { HttpError } from "@/lib/auth";
import { guard, json, route } from "@/lib/api";
import { taskProjectId } from "@/lib/queries";
import { loadPastRunsBefore } from "@/lib/runs";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * The closed runs of a task older than `?before=<run id>`, twenty at a time.
 * The newest twenty come with the task itself, so this only ever continues
 * that list. An agent reads it as a person does.
 */
export const GET = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  await guard(projectId);
  const before = new URL(req.url).searchParams.get("before");
  if (before === null) throw new HttpError(400, "Name the run to read before, as ?before=.");
  return json(await loadPastRunsBefore(taskId, before));
});
