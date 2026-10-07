import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { tasks, taskValues } from "@/db/schema";
import { logActivityIn, type ActivityEntry, type Ring } from "./activity";
import { loadProperties, type Tx } from "./queries";
import type { TaskValue } from "./types";
import { carriesValue, hidBy, withoutHidden } from "./when";

/** One value a write took away because its property stopped showing. */
export type Dropped = { taskId: string; propertyId: string; name: string };

/**
 * Takes away every value these tasks hold of a property they do not show.
 *
 * Every write that can change what a task shows calls it after its own write
 * and inside its own transaction, so a hidden value never exists for a reader
 * to act on: a Done nobody can see would still close a blocker. The row goes,
 * not its value: a null would still say the property was set.
 *
 * The caller locks the tasks with `lockTasks` before its own write. A value
 * written to one task takes no project lock, so two writes to one task — a
 * type on one side, a hidden field on the other — would each read the
 * other's old state and keep what both together hide. Locked first, the
 * second one waits, and reads after the first one's commit. Locked only
 * here, after the write, the two would deadlock: each holds a value row the
 * other's drop deletes. The lock here is a no-op for a task already held.
 *
 * The line in the activity names only what held something. The doorbell is
 * handed back, to ring after the commit. It leaves `updatedAt` alone: the
 * caller that wrote a value has already said somebody touched the task, and a
 * value a change of the board's shape took away is nobody touching it.
 */
export async function dropHidden(
  tx: Tx,
  a: {
    projectId: string;
    taskIds: string[];
    actorId: string | null;
    /** Kept on every line, as a ship's id is. */
    extra?: object;
    /** The caller's own lines, written first in the same statement. */
    before?: ActivityEntry[];
  },
): Promise<{ dropped: Dropped[]; ring: Ring }> {
  const before = a.before ?? [];
  const none = async () => ({ dropped: [], ring: await logActivityIn(tx, before) });
  const ids = [...new Set(a.taskIds)];
  if (!ids.length) return none();

  // Read with every rule already read, as the board reads them.
  const properties = await loadProperties(a.projectId, tx);
  if (!properties.some((p) => p.config.when)) return none();

  await lockTasks(tx, ids);

  const rows = await tx
    .select({
      taskId: taskValues.taskId,
      propertyId: taskValues.propertyId,
      value: taskValues.value,
    })
    .from(taskValues)
    .where(inArray(taskValues.taskId, ids));
  const byTask = new Map<string, Record<string, TaskValue>>();
  for (const row of rows) {
    const values = byTask.get(row.taskId) ?? {};
    values[row.propertyId] = row.value as TaskValue;
    byTask.set(row.taskId, values);
  }

  const dropped: Dropped[] = [];
  const entries: ActivityEntry[] = [];
  for (const [taskId, values] of byTask) {
    const kept = withoutHidden(values, properties);
    const gone = Object.keys(values).filter((id) => !(id in kept));
    if (!gone.length) continue;
    await tx
      .delete(taskValues)
      .where(and(eq(taskValues.taskId, taskId), inArray(taskValues.propertyId, gone)));
    const lost = properties.filter((p) => gone.includes(p.id) && carriesValue(values[p.id]));
    if (!lost.length) continue;
    for (const p of lost) dropped.push({ taskId, propertyId: p.id, name: p.name });
    entries.push({
      projectId: a.projectId,
      taskId,
      actorId: a.actorId,
      kind: "value",
      // The names are for people; the ids are for an agent, since a name can change.
      data: {
        dropped: lost.map((p) => p.name),
        propertyIds: lost.map((p) => p.id),
        hidBy: hidBy(values, properties, lost),
        ...a.extra,
      },
    });
  }
  return { dropped, ring: await logActivityIn(tx, [...before, ...entries]) };
}

/**
 * Locks these tasks for the rest of the transaction, in one order, so two
 * writers over the same tasks queue rather than deadlock. Every write that
 * calls `dropHidden` calls this first, before it writes a value.
 */
export async function lockTasks(tx: Tx, taskIds: string[]): Promise<void> {
  const ids = [...new Set(taskIds)];
  if (!ids.length) return;
  await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(inArray(tasks.id, ids))
    .orderBy(asc(tasks.id))
    .for("update");
}

/**
 * Every live task of a project, archived ones too, for a rule that may hide
 * values on any of them. It is the set Settings counts. A deleted task is
 * read by nothing, and a restore drops what it no longer shows.
 */
export async function projectTaskIds(tx: Tx, projectId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
  return rows.map((r) => r.id);
}
