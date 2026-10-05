import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { projects, taskLinks, tasks } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { deletedLine } from "@/lib/deleted";
import { brokenParts, PARENT } from "@/lib/links";
import {
  logActivity,
  projectLinks,
  taskCards,
  taskProjectIdEvenDeleted,
  withProjectLock,
} from "@/lib/queries";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * Puts a deleted task back, whole.
 *
 * It is the one route that may see a deleted task, which is why it asks the
 * project a different way: every other task route reads `taskProjectId` and
 * answers `404` for one. A task past its window is not here to find, because
 * the sweep took it; there is nothing to say about that beyond `404`.
 *
 * It is a member's call, an agent's as much as a person's, exactly as delete
 * is. A delete is content, not the shape of the board.
 *
 * It says what the task should be, not what to do to it, so a retry is free.
 * The update names the state it changes from, so putting back a task that is
 * already back writes no second line and rings nothing — the same rule the
 * archive pair obeys.
 *
 * A task deleted while it was archived comes back archived. `archivedAt` is
 * never touched here: the two marks are separate answers to separate
 * questions, and a put back undoes the delete and nothing else.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectIdEvenDeleted(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  /* The task keeps its rank and its key, so it comes back where it was and
     as what it was. `taskCounter` was never touched. */
  /* Under the project lock, because a parent row of the task may have to go
     with it: while it was deleted its rows refused nothing, so its parent may
     have become a part, or one of its parts may have got parts. */
  const { row, dropped } = await withProjectLock(projectId, async (tx) => {
    const [row] = await tx
      .update(tasks)
      .set({ deletedAt: null })
      .where(and(eq(tasks.id, taskId), isNotNull(tasks.deletedAt)))
      .returning({ title: tasks.title, number: tasks.number });
    if (!row) return { row, dropped: [] };

    const edges = await projectLinks(projectId, tx, PARENT);
    const cards = await taskCards([...new Set(edges.flatMap((e) => [e.fromId, e.toId]))], tx);
    const live = edges.filter((e) => !cards.get(e.fromId)?.gone && !cards.get(e.toId)?.gone);
    const dropped = brokenParts(live, taskId);
    for (const e of dropped) {
      await tx
        .delete(taskLinks)
        .where(
          and(
            eq(taskLinks.fromId, e.fromId),
            eq(taskLinks.toId, e.toId),
            eq(taskLinks.kind, PARENT),
          ),
        );
    }
    return {
      row,
      dropped: dropped.map((e) => ({ taskId: e.toId, parentKey: cards.get(e.fromId)?.key ?? "" })),
    };
  });

  if (row) {
    const [project] = await db
      .select({ key: projects.key })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    await logActivity({
      projectId,
      actorId: user.id,
      kind: "deleted",
      data: deletedLine({
        action: "restored",
        key: `${project.key}-${row.number}`,
        title: row.title,
        goesAt: null,
      }),
    });
    /* A part that left its parent says so on the part, as an unparent does. */
    for (const part of dropped) {
      await logActivity({
        projectId,
        taskId: part.taskId,
        actorId: user.id,
        kind: "link",
        data: { action: "unparented", parentKey: part.parentKey },
      });
    }
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  }

  return json({ ok: true });
});
