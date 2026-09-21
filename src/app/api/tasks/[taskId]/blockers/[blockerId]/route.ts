import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { taskLinks } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, json, readId, route } from "@/lib/api";
import { logActivity, taskCards, taskProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ taskId: string; blockerId: string }> };

/**
 * Takes the link away again. There is no confirm anywhere near it: putting it
 * back is typing the key once more.
 *
 * No lock. A link that goes can close no circle, so there is nothing here for
 * two writes at once to disagree about. A link that is already gone answers
 * ok and writes nothing, exactly as a second archive does.
 */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const { taskId, blockerId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);
  readId(blockerId, "task");

  const gone = await db
    .delete(taskLinks)
    .where(and(eq(taskLinks.fromId, blockerId), eq(taskLinks.toId, taskId)))
    .returning({ toId: taskLinks.toId });

  if (gone.length) {
    /* The key is read after the row goes, so the line names what was there
       even when the blocker was archived in between. */
    const blocker = (await taskCards([blockerId])).get(blockerId);
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "link",
      data: { action: "unlinked", blockerKey: blocker?.key ?? "" },
    });
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  }
  return json({ ok: true });
});
