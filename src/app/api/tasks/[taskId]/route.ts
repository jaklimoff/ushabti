import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, optionalStr, route, str } from "@/lib/api";
import { deletedLine, goesAt } from "@/lib/deleted";
import { loadTaskDetail, logActivity, sweepDeleted, taskProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ taskId: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  await guard(projectId);
  return json({ task: await loadTaskDetail(taskId) });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const input = await body<{ title?: string; description?: string }>(req);
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (input.title !== undefined) patch.title = str(input.title, "Title", { max: 400 });
  if (input.description !== undefined)
    patch.description = optionalStr(input.description, "Description") ?? "";

  await db.update(tasks).set(patch).where(eq(tasks.id, taskId));

  if (input.title !== undefined) {
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "title",
      data: { title: patch.title },
    });
  }
  if (input.description !== undefined) {
    await logActivity({ projectId, taskId, actorId: user.id, kind: "description", data: {} });
  }

  await broadcast({ projectId, scope: "task", taskId, clientId: clientIdOf(req) });
  return json({ ok: true });
});

/**
 * Deletes the task, for thirty days.
 *
 * The row is marked rather than taken away. It leaves every board, list,
 * search and count in the same breath — every read asks `deletedAt` — and
 * every route about it answers `404`, which is what delete means to whoever
 * holds the id. What it does not mean any more is that the work is gone: the
 * drawer lists it, one press puts it back whole, and the key it comes back
 * with is the key it had.
 *
 * The answer says when that stops being true. A caller reading `goesAt` needs
 * nothing else to tell somebody how long they have.
 */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const at = new Date();
  const [row] = await db
    .update(tasks)
    .set({ deletedAt: at })
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .returning({ title: tasks.title, number: tasks.number });
  if (!row) throw new HttpError(404, "Task not found.");

  const [project] = await db
    .select({ key: projects.key })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const goes = goesAt(at);
  await logActivity({
    projectId,
    actorId: user.id,
    kind: "deleted",
    /* No `taskId`: `activity.task_id` cascades, so a line naming the task
       would be swept away with the task it is the record of. The key is what
       points at it instead, and the key outlives the row. */
    data: deletedLine({
      action: "deleted",
      key: `${project.key}-${row.number}`,
      title: row.title,
      goesAt: goes,
    }),
  });

  /* The sweep is on the write, as the reset links are. One delete pays for
     the rows of this project that ran out. */
  await sweepDeleted(projectId, at);

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true, goesAt: goes });
});
