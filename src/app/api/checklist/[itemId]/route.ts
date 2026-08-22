import { eq } from "drizzle-orm";
import { db } from "@/db";
import { checklistItems } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route, str } from "@/lib/api";
import { checklistTaskId, logActivity, taskProjectId } from "@/lib/queries";

type Ctx = { params: Promise<{ itemId: string }> };

async function locate(itemId: string) {
  const taskId = await checklistTaskId(itemId);
  if (!taskId) throw new HttpError(404, "Checklist item not found.");
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Checklist item not found.");
  return { taskId, projectId };
}

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { itemId } = await ctx.params;
  const { taskId, projectId } = await locate(itemId);
  const { user } = await guard(projectId);

  const input = await body<{ text?: string; done?: boolean }>(req);
  const patch: Record<string, unknown> = {};
  if (input.text !== undefined) patch.text = str(input.text, "Checklist item", { max: 400 });
  if (input.done !== undefined) patch.done = !!input.done;
  if (Object.keys(patch).length === 0) return json({ ok: true });

  const [item] = await db
    .update(checklistItems)
    .set(patch)
    .where(eq(checklistItems.id, itemId))
    .returning();

  if (input.done !== undefined) {
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "checklist",
      data: { text: item.text, action: input.done ? "checked" : "unchecked" },
    });
  }
  await broadcast({ projectId, scope: "task", taskId, clientId: clientIdOf(req) });
  return json({ item });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { itemId } = await ctx.params;
  const { taskId, projectId } = await locate(itemId);
  await guard(projectId);
  await db.delete(checklistItems).where(eq(checklistItems.id, itemId));
  await broadcast({ projectId, scope: "task", taskId, clientId: clientIdOf(req) });
  return json({ ok: true });
});
