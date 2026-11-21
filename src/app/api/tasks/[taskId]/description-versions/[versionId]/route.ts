import { HttpError } from "@/lib/auth";
import { guard, json, readId, route } from "@/lib/api";
import { readVersion } from "@/lib/description-versions";
import { taskProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ taskId: string; versionId: string }> };

/**
 * One edit of a description, both texts. `guard()` alone, on purpose: an
 * agent may read what a person had written, as it reads the task itself.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { taskId, versionId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  await guard(projectId);
  const version = await readVersion(taskId, readId(versionId, "version"));
  if (!version) throw new HttpError(404, "Version not found.");
  return json({ version });
});
