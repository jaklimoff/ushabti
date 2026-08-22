import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { commentRow, taskProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ commentId: string }> };

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { commentId } = await ctx.params;
  const row = await commentRow(commentId);
  if (!row) throw new HttpError(404, "Comment not found.");
  const projectId = await taskProjectId(row.taskId);
  if (!projectId) throw new HttpError(404, "Comment not found.");
  const { user, membership } = await guard(projectId);

  if (row.authorId !== user.id && membership.role !== "owner") {
    throw new HttpError(403, "You can only delete your own comments.");
  }

  await db.delete(comments).where(eq(comments.id, commentId));
  await broadcast({ projectId, scope: "task", taskId: row.taskId, clientId: clientIdOf(req) });
  return json({ ok: true });
});
