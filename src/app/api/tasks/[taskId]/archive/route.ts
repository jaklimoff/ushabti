import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { logActivity, taskProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * Archiving takes a task off every board and list and keeps everything else:
 * its comments, its checklist, its history and its link.
 *
 * Both calls are a member's, an agent's as much as a person's. An agent may
 * archive the task it just finished for the same reason it may close its own
 * run: it is the content of the board, not the shape of it. The sweep of a
 * whole column is the one that is a person's, and it lives on the project.
 *
 * Both say what the task should be, not what to do to it, so a retry is free.
 * The update names the state it changes from, and only a row that really
 * moved is logged and rung. A second archive would otherwise rewrite the
 * moment the task went — which is the one thing its history has to keep — and
 * a put back on a live task would write a line for nothing. An agent that
 * loses the answer and calls again is the ordinary case, not a rare one.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const archived = await db
    .update(tasks)
    .set({ archivedAt: new Date() })
    .where(and(eq(tasks.id, taskId), isNull(tasks.archivedAt)))
    .returning({ id: tasks.id });

  if (archived.length) {
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "archive",
      data: { action: "archived" },
    });
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  }
  return json({ ok: true });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  /* The task keeps its rank, so it comes back where it was. */
  const restored = await db
    .update(tasks)
    .set({ archivedAt: null })
    .where(and(eq(tasks.id, taskId), isNotNull(tasks.archivedAt)))
    .returning({ id: tasks.id });

  if (restored.length) {
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "archive",
      data: { action: "restored" },
    });
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  }
  return json({ ok: true });
});
