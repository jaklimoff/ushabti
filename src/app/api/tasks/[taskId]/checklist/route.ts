import { eq } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { checklistItems } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route, str } from "@/lib/api";
import { logActivity, taskProjectId, withProjectLock } from "@/lib/queries";
import { rankAfter } from "@/lib/rank";

type Ctx = { params: Promise<{ taskId: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const input = await body<{ text?: string }>(req);
  const text = str(input.text, "Checklist item", { max: 400 });

  const item = await withProjectLock(projectId, async (tx) => {
    const siblings = await tx
      .select({ position: checklistItems.position })
      .from(checklistItems)
      .where(eq(checklistItems.taskId, taskId))
      .orderBy(byPos(checklistItems.position));

    const [row] = await tx
      .insert(checklistItems)
      .values({ taskId, text, position: rankAfter(siblings.at(-1)?.position ?? null) })
      .returning();
    return row;
  });

  await logActivity({
    projectId,
    taskId,
    actorId: user.id,
    kind: "checklist",
    data: { text, action: "added" },
  });
  await broadcast({ projectId, scope: "task", taskId, clientId: clientIdOf(req) });
  return json({ item }, 201);
});
