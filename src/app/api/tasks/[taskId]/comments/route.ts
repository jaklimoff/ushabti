import { db } from "@/db";
import { comments } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route, str } from "@/lib/api";
import { logActivity, taskProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ taskId: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const input = await body<{ body?: string }>(req);
  const text = str(input.body, "Comment", { max: 8000 });

  const [comment] = await db
    .insert(comments)
    .values({ taskId, authorId: user.id, body: text })
    .returning();

  await logActivity({ projectId, taskId, actorId: user.id, kind: "comment", data: {} });
  await broadcast({ projectId, scope: "task", taskId, clientId: clientIdOf(req) });
  return json(
    { comment: { ...comment, author: { id: user.id, name: user.name, color: user.color } } },
    201,
  );
});
