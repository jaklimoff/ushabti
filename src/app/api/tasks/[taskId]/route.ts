import { and, eq, isNull, or } from "drizzle-orm";
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

/**
 * Writes the title or the description, or both.
 *
 * A caller may send the text it started from as `baseTitle` or
 * `baseDescription`. Then the write happens only while the field still holds
 * that text, and the compare is in the same statement as the update, so no
 * second write can slip in between. If somebody else changed it first, the
 * answer is `409` with `current`, the saved text, and nothing is written.
 * A field that already holds the new words is not a clash: nothing is lost.
 *
 * The compare is on the text and not on `updated_at`, because a value or a
 * tick moves that too, and a Priority change must not refuse a description.
 * Without a base the last write wins, as it always did, so an agent and an
 * old client work unchanged.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const input = await body<{
    title?: string;
    description?: string;
    baseTitle?: string;
    baseDescription?: string;
  }>(req);
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (input.title !== undefined) patch.title = str(input.title, "Title", { max: 400 });
  if (input.description !== undefined)
    patch.description = optionalStr(input.description, "Description") ?? "";

  const baseTitle =
    input.title !== undefined ? optionalStr(input.baseTitle, "The base title") : undefined;
  const baseDescription =
    input.description !== undefined
      ? optionalStr(input.baseDescription, "The base description")
      : undefined;

  const unchanged = [eq(tasks.id, taskId)];
  if (baseTitle !== undefined)
    unchanged.push(or(eq(tasks.title, baseTitle), eq(tasks.title, patch.title as string))!);
  if (baseDescription !== undefined)
    unchanged.push(
      or(
        eq(tasks.description, baseDescription),
        eq(tasks.description, patch.description as string),
      )!,
    );

  const written = await db
    .update(tasks)
    .set(patch)
    .where(and(...unchanged))
    .returning({ id: tasks.id });

  if (written.length === 0) {
    const [row] = await db
      .select({ title: tasks.title, description: tasks.description })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!row) throw new HttpError(404, "Task not found.");
    /* Only a base can refuse a write, so the field is the one whose base no
       longer holds. The title is asked first; a caller that sends both learns
       of the second clash on its next try. */
    const field =
      baseTitle !== undefined && row.title !== baseTitle && row.title !== patch.title
        ? "title"
        : "description";
    return json({ error: "This changed while you typed.", field, current: row[field] }, 409);
  }

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
