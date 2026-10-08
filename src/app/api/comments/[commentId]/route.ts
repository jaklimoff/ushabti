import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, optionalStr, route, str } from "@/lib/api";
import { commentRow, logActivity, taskProjectId, touchTasks } from "@/lib/queries";
import { canManage } from "@/lib/roles";

type Ctx = { params: Promise<{ commentId: string }> };

/**
 * Writes new words into a comment. Only its author may, person or agent: an
 * owner or an admin may take somebody's comment down, but never put words in
 * it. A caller may send `baseBody`, the words it started from, and then the
 * words are written only while the comment still holds them — in the same
 * statement, so nothing slips in between. If they changed, the answer is
 * `409` with `current`, as the task route answers. The same words write
 * nothing, so "edited" never marks a save that changed nothing.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { commentId } = await ctx.params;
  const row = await commentRow(commentId);
  if (!row) throw new HttpError(404, "Comment not found.");
  const projectId = await taskProjectId(row.taskId);
  if (!projectId) throw new HttpError(404, "Comment not found.");
  const { user } = await guard(projectId);
  if (row.authorId !== user.id) throw new HttpError(403, "You can only edit your own comments.");

  const input = await body<{ body?: string; baseBody?: string }>(req);
  if (typeof input.body === "string" && input.body.trim() === "")
    throw new HttpError(400, "A comment cannot be empty. Delete it instead.");
  const text = str(input.body, "Comment", { max: 8000 });
  const baseBody = optionalStr(input.baseBody, "The base body");
  if (text === row.body) return json({ comment: row });

  const unchanged = [eq(comments.id, commentId)];
  if (baseBody !== undefined)
    unchanged.push(or(eq(comments.body, baseBody), eq(comments.body, text))!);

  const comment = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(comments)
      .set({ body: text, editedAt: new Date() })
      .where(and(...unchanged))
      .returning();
    if (row) await touchTasks([row.taskId], tx);
    return row;
  });

  if (!comment) {
    const [now] = await db
      .select({ body: comments.body })
      .from(comments)
      .where(eq(comments.id, commentId))
      .limit(1);
    if (!now) throw new HttpError(404, "Comment not found.");
    return json({ error: "This changed while you typed.", field: "body", current: now.body }, 409);
  }

  // The line says that the words changed, never what they said before.
  await logActivity({
    projectId,
    taskId: row.taskId,
    actorId: user.id,
    kind: "comment",
    data: { commentId, action: "edited" },
  });
  await broadcast({ projectId, scope: "task", taskId: row.taskId, clientId: clientIdOf(req) });
  return json({ comment });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { commentId } = await ctx.params;
  const row = await commentRow(commentId);
  if (!row) throw new HttpError(404, "Comment not found.");
  const projectId = await taskProjectId(row.taskId);
  if (!projectId) throw new HttpError(404, "Comment not found.");
  const { user, membership } = await guard(projectId);

  /* Anybody may take back their own words. Somebody else's comment is taken
     down by the owner or an admin, and only by a person. */
  if (row.authorId !== user.id && (user.kind !== "human" || !canManage(membership.role))) {
    throw new HttpError(403, "You can only delete your own comments.");
  }

  await db.transaction(async (tx) => {
    const gone = await tx
      .delete(comments)
      .where(eq(comments.id, commentId))
      .returning({ taskId: comments.taskId });
    await touchTasks(
      gone.map((g) => g.taskId),
      tx,
    );
  });
  /* The line says who took whose comment down, never what it said: the words
     are gone on purpose. The author goes by id, so a renamed person reads by
     the name they have now. */
  await logActivity({
    projectId,
    taskId: row.taskId,
    actorId: user.id,
    kind: "comment",
    data: { commentId, action: "deleted", authorId: row.authorId, byProject: row.byProject },
  });
  await broadcast({ projectId, scope: "task", taskId: row.taskId, clientId: clientIdOf(req) });
  return json({ ok: true });
});
