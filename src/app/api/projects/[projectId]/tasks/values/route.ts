import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskValues } from "@/db/schema";
import { body, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { changed, readChange, readTaskIds, rowsSaid } from "@/lib/bulk";
import { dropHidden, lockTasks } from "@/lib/hidden";
import type { TaskValue } from "@/lib/types";
import { coerceValue, describeValue, loadProperty, valueLine } from "@/lib/values";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Sets one property on many tasks, in one call.
 *
 * The board picks the cards and this writes them: one `coerceValue`, one
 * upsert, one line of activity for each task, one broadcast. Ten calls to the
 * task route would do the same work ten times over, ring the doorbell ten
 * times, and stop halfway with nothing saying where.
 *
 * There is **no project lock**. The lock serialises the writes that read their
 * neighbours and then write a rank — a new task, a move, a reordered option.
 * A value is none of those: it touches no rank and no counter, and the last
 * write of two wins, exactly as it does on the task route.
 *
 * It is **not** `humanOnly`. A value is content, not shape, and an agent may
 * already write ten of them with ten calls. The column sweep beside it is
 * guarded because it names a value and takes away cards nobody counted; this
 * names the ids.
 *
 * A multi-select is changed one option at a time: `change` is "add" or
 * "remove" and `value` is the one option. Each task keeps the rest of its
 * list, so a task's own list is read under the lock it is written under, and
 * a task the change would leave as it was is not written at all.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);

  const input = await body<{
    taskIds?: unknown;
    propertyId?: unknown;
    value?: unknown;
    change?: unknown;
  }>(req);

  const read = readTaskIds(input.taskIds);
  if (!read.ok) throw new HttpError(400, read.said);
  const { ids } = read;

  if (typeof input.propertyId !== "string") {
    throw new HttpError(400, "Name the property to set.");
  }
  const property = await loadProperty(input.propertyId);
  if (property.projectId !== projectId) {
    throw new HttpError(400, "That property is not in this project.");
  }

  const asked = readChange(input.change, property.type);
  if (!asked.ok) throw new HttpError(400, asked.said);
  const { change } = asked;

  /* Once, for every task. The value is the same for all of them, so checking
     it once is both the cheap answer and the only one that can be consistent:
     a coerce that passed for one task and failed for the next would be a
     board half set. A change names one option, and is checked as a list of
     one. */
  if (change && typeof input.value !== "string") {
    throw new HttpError(400, `Name the one ${property.name} option to add or take off.`);
  }
  const value = await coerceValue(property, change ? [input.value] : (input.value ?? null));
  const optionId = change ? (value as string[])[0] : null;

  /* Every id has to be a live task of this project. A task of another project
     is simply not among the rows, and a deleted one is not either, because
     every read hides it. The sentence is the same either way: what a token
     may not see, it may not name. */
  const rows = await db
    .select({ id: tasks.id, archivedAt: tasks.archivedAt })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, ids), isNull(tasks.deletedAt)));

  const said = rowsSaid(ids, rows);
  if (said) throw new HttpError(400, said);

  const { written, dropped, ring } = await db.transaction(async (tx) => {
    await lockTasks(tx, ids);
    /* A value reads the same on every task it lands on, so each list is named
       once however many tasks carry it, and inside the transaction, so a
       full pool cannot leave it waiting on itself. */
    const said = new Map<string, Promise<string>>();
    const describe = (v: TaskValue) => {
      const key = JSON.stringify(v);
      if (!said.has(key)) said.set(key, describeValue(property, v, tx));
      return said.get(key)!;
    };
    let writes: { taskId: string; value: TaskValue }[] = ids.map((taskId) => ({ taskId, value }));
    if (change && optionId) {
      const had = await tx
        .select({ taskId: taskValues.taskId, value: taskValues.value })
        .from(taskValues)
        .where(and(eq(taskValues.propertyId, property.id), inArray(taskValues.taskId, ids)));
      const before = new Map(had.map((row) => [row.taskId, row.value as TaskValue]));
      writes = [];
      for (const taskId of ids) {
        const old = before.get(taskId) ?? null;
        const next = changed(old, change, optionId);
        const oldList = Array.isArray(old) ? old : [];
        if (next.length !== oldList.length) writes.push({ taskId, value: next });
      }
    }
    if (writes.length === 0) {
      return { written: 0, dropped: [], ring: async () => {} };
    }
    const touched = writes.map((w) => w.taskId);
    await tx
      .insert(taskValues)
      .values(writes.map((w) => ({ taskId: w.taskId, propertyId: property.id, value: w.value })))
      .onConflictDoUpdate({
        target: [taskValues.taskId, taskValues.propertyId],
        set: { value: sql`excluded.value` },
      });
    await tx.update(tasks).set({ updatedAt: new Date() }).where(inArray(tasks.id, touched));
    const lines = await Promise.all(
      writes.map(async (w) => ({
        projectId,
        taskId: w.taskId,
        actorId: user.id,
        kind: "value",
        data: valueLine(property, w.value, await describe(w.value)),
      })),
    );
    /* One line on each task, the same kind and the same shape the task route
       writes, because the history of a task says what happened to it however
       it happened. Through the funnel, so the webhook rings for each one, and
       before the lines of what it hid, which are its effect. */
    const done = await dropHidden(tx, {
      projectId,
      taskIds: touched,
      actorId: user.id,
      before: lines,
    });
    return { written: writes.length, ...done };
  });
  await ring();
  if (written > 0) await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });

  /* `set` counts the tasks that changed. A change on tasks that all had it,
     or none of which had it, sets nothing, and says so. */
  return json({ set: written, value: optionId ?? value, change, dropped });
});
