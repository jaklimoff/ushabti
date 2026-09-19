import { HttpError } from "@/lib/auth";
import { guard, json, route } from "@/lib/api";
import { loadActivityFeed } from "@/lib/queries";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * What happened in a project after a moment, oldest first.
 *
 * The stream rings; this is what it rang about. An agent that waits for work
 * reads it after every ring and after every reconnect, so a task created
 * while its socket was down still reaches it. Without `after` it answers
 * nothing and the server's clock, which is where a new reader starts.
 *
 * Any member may read it, a person or an agent: it says nothing the task
 * panels do not already say.
 */
export const GET = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  await guard(projectId);

  const url = new URL(req.url);
  const afterRaw = url.searchParams.get("after");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200));

  if (!afterRaw) return json({ entries: [], now: new Date().toISOString() });

  const after = new Date(afterRaw);
  if (Number.isNaN(after.getTime())) throw new HttpError(400, "after must be an ISO date.");

  const entries = await loadActivityFeed(projectId, after, limit);
  return json({ entries, now: new Date().toISOString() });
});
