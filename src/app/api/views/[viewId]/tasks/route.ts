import { HttpError, requireActor } from "@/lib/auth";
import { guard, json, route } from "@/lib/api";
import { loadBoard, viewProjectId } from "@/lib/queries";
import { viewQueue } from "@/lib/queue";

type Ctx = { params: Promise<{ viewId: string }> };

const GONE = "That view does not exist.";

/**
 * The tasks a view shows right now, in its order: what an agent takes next.
 *
 * It reads the board the screen reads and asks `viewQueue`, so it answers
 * with the view's own rules and order and never a lens, and "me" is the
 * caller. An agent and a person may both ask. A view of a project the caller
 * cannot open answers as a view that is not there, so the answer does not say
 * which views exist elsewhere.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { viewId } = await ctx.params;
  const actor = await requireActor();
  const projectId = await viewProjectId(viewId);
  if (!projectId || (actor.tokenProjectId && actor.tokenProjectId !== projectId)) {
    throw new HttpError(404, GONE);
  }
  const { user, membership } = await guard(projectId);
  /* No viewer: nobody's lens is read, not even the caller's. */
  const board = await loadBoard(projectId, membership.role, null);
  const queue = viewQueue(board, viewId, user.id);
  // Deleted between the two reads.
  if (!queue) throw new HttpError(404, GONE);
  return json(queue);
});
