import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { checklistItems } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, optionalStr, route, str } from "@/lib/api";
import { checklistTaskId, logActivity, taskProjectId, touchTasks } from "@/lib/queries";

type Ctx = { params: Promise<{ itemId: string }> };

async function locate(itemId: string) {
  const taskId = await checklistTaskId(itemId);
  if (!taskId) throw new HttpError(404, "Checklist item not found.");
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Checklist item not found.");
  return { taskId, projectId };
}

/**
 * Writes an item's words or its tick. A caller may send `baseText`, the words
 * it started from, and then the words are written only while the item still
 * holds them — in the same statement, so nothing slips in between. If they
 * changed, the answer is `409` with `current` and nothing is written, the tick
 * included. The base guards the words only: a tick never refuses an edit, and
 * an edit never refuses a tick.
 */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { itemId } = await ctx.params;
  const { taskId, projectId } = await locate(itemId);
  const { user } = await guard(projectId);

  const input = await body<{ text?: string; done?: boolean; baseText?: string }>(req);
  const patch: Record<string, unknown> = {};
  if (input.text !== undefined) patch.text = str(input.text, "Checklist item", { max: 400 });
  if (input.done !== undefined) patch.done = !!input.done;
  if (Object.keys(patch).length === 0) return json({ ok: true });

  const baseText =
    input.text !== undefined ? optionalStr(input.baseText, "The base text") : undefined;
  const unchanged = [eq(checklistItems.id, itemId)];
  if (baseText !== undefined)
    unchanged.push(
      or(eq(checklistItems.text, baseText), eq(checklistItems.text, patch.text as string))!,
    );

  const { item, before } = await db.transaction(async (tx) => {
    // The old words are read under a row lock, so the feed names what the
    // edit replaced and not what a second edit left behind.
    const [old] =
      patch.text === undefined
        ? []
        : await tx
            .select({ text: checklistItems.text })
            .from(checklistItems)
            .where(eq(checklistItems.id, itemId))
            .for("update");
    const [row] = await tx
      .update(checklistItems)
      .set(patch)
      .where(and(...unchanged))
      .returning();
    if (row) await touchTasks([taskId], tx);
    return { item: row, before: old?.text };
  });

  if (!item) {
    const [row] = await db
      .select({ text: checklistItems.text })
      .from(checklistItems)
      .where(eq(checklistItems.id, itemId))
      .limit(1);
    if (!row) throw new HttpError(404, "Checklist item not found.");
    return json({ error: "This changed while you typed.", current: row.text }, 409);
  }

  if (input.done !== undefined) {
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "checklist",
      data: { text: item.text, action: input.done ? "checked" : "unchecked" },
    });
  }
  if (before !== undefined && before !== item.text) {
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "checklist",
      data: { text: item.text, from: before, action: "renamed" },
    });
  }
  await broadcast({ projectId, scope: "task", taskId, clientId: clientIdOf(req) });
  return json({ item });
});

/** A removed item leaves its words in the feed, so a check nobody met cannot vanish unseen. */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const { itemId } = await ctx.params;
  const { taskId, projectId } = await locate(itemId);
  const { user } = await guard(projectId);
  const gone = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(checklistItems)
      .where(eq(checklistItems.id, itemId))
      .returning({ text: checklistItems.text });
    if (rows.length) await touchTasks([taskId], tx);
    return rows[0];
  });
  if (gone) {
    await logActivity({
      projectId,
      taskId,
      actorId: user.id,
      kind: "checklist",
      data: { text: gone.text, action: "removed" },
    });
  }
  await broadcast({ projectId, scope: "task", taskId, clientId: clientIdOf(req) });
  return json({ ok: true });
});
