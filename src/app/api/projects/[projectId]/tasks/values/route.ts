import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskValues } from "@/db/schema";
import { logActivityAll } from "@/lib/activity";
import { body, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { readTaskIds, rowsSaid } from "@/lib/bulk";
import { coerceValue, describeValue, loadProperty } from "@/lib/values";

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
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);

  const input = await body<{ taskIds?: unknown; propertyId?: unknown; value?: unknown }>(req);

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

  /* Once, for every task. The value is the same for all of them, so checking
     it once is both the cheap answer and the only one that can be consistent:
     a coerce that passed for one task and failed for the next would be a
     board half set. */
  const value = await coerceValue(property, input.value ?? null);

  /* Every id has to be a live task of this project. A task of another project
     is simply not among the rows, and the sentence is the same either way:
     what a token may not see, it may not name. */
  const rows = await db
    .select({ id: tasks.id, archivedAt: tasks.archivedAt })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, ids)));

  const said = rowsSaid(ids, rows);
  if (said) throw new HttpError(400, said);

  await db.transaction(async (tx) => {
    await tx
      .insert(taskValues)
      .values(ids.map((taskId) => ({ taskId, propertyId: property.id, value })))
      .onConflictDoUpdate({
        target: [taskValues.taskId, taskValues.propertyId],
        set: { value: sql`excluded.value` },
      });
    await tx.update(tasks).set({ updatedAt: new Date() }).where(inArray(tasks.id, ids));
  });

  /* One line on each task, the same kind and the same shape the task route
     writes, because the history of a task says what happened to it however it
     happened. Through the funnel, so the webhook rings for each one. */
  const described = await describeValue(property, value);
  await logActivityAll(
    ids.map((taskId) => ({
      projectId,
      taskId,
      actorId: user.id,
      kind: "value",
      // The name is for people; the id is for an agent, since a name can change.
      data: { property: property.name, propertyId: property.id, value: described },
    })),
  );
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });

  return json({ set: ids.length, value });
});
