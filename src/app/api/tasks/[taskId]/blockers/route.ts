import { taskLinks } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, readId, route } from "@/lib/api";
import { circleSaid, SELF_LINK_SAID, wouldCircle } from "@/lib/links";
import {
  logActivity,
  projectLinks,
  taskCards,
  taskProjectId,
  withProjectLock,
} from "@/lib/queries";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * Says what this task waits on: `{ blockerId }`, the task that blocks it.
 *
 * A link is content, not shape, so an agent writes one as readily as a person
 * does. An agent that picks a task up has to be able to say "this needs that
 * first", and the person reading the board has to see why a card is not
 * moving. Today that lives in comments, where nothing can read it.
 *
 * The whole write sits under the project lock, because the circle check reads
 * every link of the project and then writes one. Two links that each close
 * the circle the other left open would otherwise both pass.
 *
 * A link that is already there answers ok and writes nothing. An agent that
 * lost the answer and calls again is the ordinary case, not a rare one.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const input = await body<{ blockerId?: unknown }>(req);
  const blockerId = readId(input.blockerId, "task");

  /* Its own sentence. "This would be a circle" would name one task twice and
     read as a fault of the board rather than of the request. */
  if (blockerId === taskId) throw new HttpError(409, SELF_LINK_SAID);

  const linked = await withProjectLock(projectId, async (tx) => {
    const cards = await taskCards([taskId, blockerId], tx);
    const mine = cards.get(taskId);
    const blocker = cards.get(blockerId);
    /* A link across two boards is out of this version: a key from another
       project says nothing on this one. A deleted task is out for the same
       reason a board never draws one. */
    if (!mine || !blocker || blocker.gone || blocker.projectId !== projectId) {
      throw new HttpError(404, "That task is not on this board.");
    }

    const edges = await projectLinks(projectId, tx);
    if (wouldCircle(edges, blockerId, taskId)) {
      throw new HttpError(409, circleSaid(blocker.key, mine.key));
    }

    const landed = await tx
      .insert(taskLinks)
      .values({ fromId: blockerId, toId: taskId })
      .onConflictDoNothing()
      .returning({ toId: taskLinks.toId });

    return landed.length ? blocker.key : null;
  });

  if (linked) {
    /* The line goes on the task that gained the blocker. That is the card
       whose chain glyph appeared, and the panel showing it is that task's. */
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "link",
      data: { action: "linked", blockerKey: linked },
    });
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  }
  return json({ ok: true });
});
