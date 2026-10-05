import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { taskLinks } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, readId, route } from "@/lib/api";
import { PARENT, parentRefusal, SELF_PARENT_SAID } from "@/lib/links";
import {
  logActivity,
  projectLinks,
  taskCards,
  taskProjectId,
  withProjectLock,
} from "@/lib/queries";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * Makes this task part of another: `{ parentId }`. A task that already has a
 * parent moves to the new one, because a task has one parent at most.
 *
 * Splitting work is content, as a blocker is, so an agent may do it too.
 *
 * The write sits under the project lock: the one-level check reads the parent
 * rows of the project and then writes one, and two writes that each made the
 * other a second level would otherwise both pass.
 *
 * The parent it already has answers ok and writes nothing.
 */
export const PUT = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const input = await body<{ parentId?: unknown }>(req);
  const parentId = readId(input.parentId, "task");
  if (parentId === taskId) throw new HttpError(409, SELF_PARENT_SAID);

  const linked = await withProjectLock(projectId, async (tx) => {
    /* Only the rows that touch the two tasks can refuse or be replaced. */
    const touching = (await projectLinks(projectId, tx, PARENT)).filter((e) =>
      [parentId, taskId].some((id) => id === e.fromId || id === e.toId),
    );
    const ends = new Set([taskId, parentId, ...touching.flatMap((e) => [e.fromId, e.toId])]);
    const cards = await taskCards([...ends], tx);
    const mine = cards.get(taskId);
    const parent = cards.get(parentId);
    if (!mine || !parent || parent.gone || parent.projectId !== projectId) {
      throw new HttpError(404, "That task is not on this board.");
    }

    /* A deleted task is off every board, so its rows refuse nothing. */
    const live = touching.filter((e) => !cards.get(e.fromId)?.gone && !cards.get(e.toId)?.gone);
    const refused = parentRefusal(live, parentId, taskId, (id) => cards.get(id)?.key ?? "");
    if (refused) throw new HttpError(409, refused);

    const had = touching.find((e) => e.toId === taskId);
    if (had?.fromId === parentId) return null;

    await tx.delete(taskLinks).where(and(eq(taskLinks.toId, taskId), eq(taskLinks.kind, PARENT)));
    await tx.insert(taskLinks).values({ fromId: parentId, toId: taskId, kind: PARENT });
    /* The parent it left, unless that one is deleted: nobody can see it. */
    const left = had && !cards.get(had.fromId)?.gone ? cards.get(had.fromId)!.key : null;
    return { parentKey: parent.key, left };
  });

  if (linked) {
    /* The line goes on the child: it is the task that changed. Its kind is
       `link`, so a webhook that rings for links rings for this one too. */
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "link",
      data: { action: "parented", parentKey: linked.parentKey },
    });
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  }
  /* `left` names the parent the task moved away from, so a screen that
     added a part can say the part left somewhere else. */
  return json({ ok: true, left: linked?.left ?? null });
});

/**
 * Takes this task out of its parent. No lock: a parent that goes can make no
 * second level. A task with no parent answers ok and writes nothing.
 */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const gone = await db
    .delete(taskLinks)
    .where(and(eq(taskLinks.toId, taskId), eq(taskLinks.kind, PARENT)))
    .returning({ fromId: taskLinks.fromId });

  if (gone.length) {
    const parent = (await taskCards([gone[0].fromId])).get(gone[0].fromId);
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "link",
      data: { action: "unparented", parentKey: parent?.key ?? "" },
    });
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  }
  return json({ ok: true });
});
