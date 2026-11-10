import { and, asc, eq, ne } from "drizzle-orm";
import { tasks, taskValues } from "@/db/schema";
import type { ActivityEntry } from "@/lib/activity";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { byPos } from "@/lib/order";
import { rankOnTheEnd, taskProjectId, touchTasks, withProjectLock } from "@/lib/queries";
import { rankBetween } from "@/lib/rank";
import { dropHidden, lockTasks } from "@/lib/hidden";
import type { TaskValue } from "@/lib/types";
import {
  coerceValue,
  describeValue,
  loadProperty,
  valueLine,
  type PropertyRow,
} from "@/lib/values";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * One drag = one call. `beforeId` is the task the card must land in front of
 * inside the target column; `afterId` is the task it must follow. `values`
 * carries the column property, so a move across columns is a single write.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const input = await body<{
    beforeId?: string | null;
    afterId?: string | null;
    values?: Record<string, unknown>;
  }>(req);

  /* A column is a value, and a value can hide others: they go together, in
     the one transaction that writes the rank, so a refused value leaves the
     card where it was. Every value is checked first, through the shared pool:
     nothing inside the transaction asks for a second connection. */
  const values = input.values && typeof input.values === "object" ? input.values : {};
  const changes: { prop: PropertyRow; value: TaskValue }[] = [];
  for (const [propertyId, raw] of Object.entries(values)) {
    const prop = await loadProperty(propertyId);
    if (prop.projectId !== projectId) continue;
    changes.push({ prop, value: await coerceValue(prop, raw, [taskId]) });
  }

  const { position, rewrote, dropped, ring } = await withProjectLock(projectId, async (tx) => {
    const siblings = await tx
      .select({ id: tasks.id, position: tasks.position })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), ne(tasks.id, taskId)))
      .orderBy(byPos(tasks.position), asc(tasks.number));

    let lower: string | null = null;
    let upper: string | null = null;
    /* True when the card lands last. Only then can the tail be rewritten: the
       room above any other neighbour belongs to the task above it. */
    let onTheEnd = siblings.length > 0 && !input.beforeId;

    if (input.beforeId) {
      const i = siblings.findIndex((t) => t.id === input.beforeId);
      if (i >= 0) {
        lower = siblings[i - 1]?.position ?? null;
        upper = siblings[i].position;
      }
    } else if (input.afterId) {
      const i = siblings.findIndex((t) => t.id === input.afterId);
      if (i >= 0) {
        lower = siblings[i].position;
        upper = siblings[i + 1]?.position ?? null;
      }
      onTheEnd = i === siblings.length - 1;
    }

    const end = onTheEnd
      ? await rankOnTheEnd(tx, projectId, siblings)
      : { position: rankBetween(lower, upper), rewrote: false };
    /* A rank is not something a person said, so `updatedAt` waits for a value. */
    await tx.update(tasks).set({ position: end.position }).where(eq(tasks.id, taskId));

    const entries: ActivityEntry[] = [];
    if (changes.length) await lockTasks(tx, [taskId]);
    for (const { prop, value } of changes) {
      await tx
        .insert(taskValues)
        .values({ taskId, propertyId: prop.id, value })
        .onConflictDoUpdate({
          target: [taskValues.taskId, taskValues.propertyId],
          set: { value },
        });
      entries.push({
        projectId,
        taskId,
        actorId: user.id,
        kind: "value",
        data: valueLine(prop, value, await describeValue(prop, value, tx)),
      });
    }
    const taskIds = entries.length ? [taskId] : [];
    await touchTasks(taskIds, tx);
    return {
      ...end,
      ...(await dropHidden(tx, { projectId, taskIds, actorId: user.id, before: entries })),
    };
  });
  await ring();

  /* A rewrite moved rows this tab did not ask about, so it hears the bell too. */
  await broadcast({ projectId, scope: "board", clientId: rewrote ? undefined : clientIdOf(req) });
  return json({ position, dropped });
});
