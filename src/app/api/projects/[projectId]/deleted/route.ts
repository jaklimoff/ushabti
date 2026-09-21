import { guard, json, route } from "@/lib/api";
import { DELETE_WINDOW_DAYS } from "@/lib/deleted";
import { loadDeletedTasks } from "@/lib/queries";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * What is in the drawer: the tasks this project deleted that can still come
 * back, newest first.
 *
 * It is a read of its own and not part of the board answer, because a deleted
 * task must never reach a board. One page asks for it, and it asks only when
 * somebody opens that page.
 *
 * Any member may read it, a person or an agent. It says nothing an agent
 * could not have seen before the delete, and an agent that deleted a task by
 * mistake should be able to find it again.
 *
 * Reading it sweeps, exactly as deleting does: the list a person is about to
 * act on is the one list that must not hold a row whose window is over.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { projectId } = await ctx.params;
  await guard(projectId);

  return json({
    deleted: await loadDeletedTasks(projectId),
    /* The window is one number in the docs, and it is here as well so that a
       reader never has to know it by heart to draw the words on a row. */
    windowDays: DELETE_WINDOW_DAYS,
  });
});
