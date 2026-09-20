import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { activity, tasks, taskValues } from "@/db/schema";
import { body, broadcast, clientIdOf, guard, humanOnly, json, route } from "@/lib/api";
import { columnIdForValue } from "@/lib/board";
import type { TaskValue } from "@/lib/types";
import { coerceValue, loadProperty } from "@/lib/values";
import { HttpError } from "@/lib/auth";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Archives every live task in one column of the board.
 *
 * The body names a property and a value — never a column id — because the
 * server has no idea what a column is. A column *is* one value of the property
 * the view groups by, and `columnIdForValue` is the same answer the board
 * itself draws with, so "everything in Shipped" means the same thing on both
 * sides of the wire. It also answers the column that holds the tasks with no
 * value at all: that one is `value: null`.
 *
 * It is `humanOnly`. One call here can clear forty cards off the board, and
 * sweeping a column is a decision about the board rather than work on a task.
 * An agent archives the one task it finished, through the task route.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);
  humanOnly(user);

  const input = await body<{ propertyId?: string; value?: unknown }>(req);
  if (typeof input.propertyId !== "string") {
    throw new HttpError(400, "Name the property the columns come from.");
  }
  const property = await loadProperty(input.propertyId);
  if (property.projectId !== projectId) {
    throw new HttpError(400, "That property is not in this project.");
  }
  const wanted = columnIdForValue(await coerceValue(property, input.value ?? null), property);

  /* A task with no row for this property is in the "no value" column, so the
     join is a left one and the filtering happens here rather than in SQL. */
  const rows = await db
    .select({ id: tasks.id, value: taskValues.value })
    .from(tasks)
    .leftJoin(
      taskValues,
      and(eq(taskValues.taskId, tasks.id), eq(taskValues.propertyId, property.id)),
    )
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt)));

  const ids = rows
    .filter((r) => columnIdForValue(r.value as TaskValue, property) === wanted)
    .map((r) => r.id);

  if (ids.length) {
    await db.update(tasks).set({ archivedAt: new Date() }).where(inArray(tasks.id, ids));
    /* One line on each task, exactly as archiving one task writes one line:
       the history of a task says what happened to it, however it happened. */
    await db.insert(activity).values(
      ids.map((taskId) => ({
        projectId,
        taskId,
        actorId: user.id,
        kind: "archive",
        data: { action: "archived" },
      })),
    );
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  }

  return json({ archived: ids.length });
});
