import { guard, json, route } from "@/lib/api";
import { loadChangelog } from "@/lib/changelog-load";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * The changelog the member page draws: every shipped option, newest first,
 * with its note and the tasks that carry it.
 *
 * Any member may read it, a person or an agent. An agent writes release notes
 * from it, and it says nothing an agent could not read off the board and the
 * archive. The keys are here for the same agent; only the public page drops
 * them.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { projectId } = await ctx.params;
  await guard(projectId);
  const log = await loadChangelog(projectId);
  return json({ changelog: log?.entries ?? [] });
});
