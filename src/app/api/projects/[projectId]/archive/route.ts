import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskValues } from "@/db/schema";
import { logActivityAll } from "@/lib/activity";
import { body, broadcast, clientIdOf, guard, humanOnly, json, route } from "@/lib/api";
import { columnIdForValue } from "@/lib/board";
import { onBoardSaid, readArchiveAsk } from "@/lib/bulk";
import type { TaskValue } from "@/lib/types";
import { coerceValue, loadProperty } from "@/lib/values";
import { HttpError } from "@/lib/auth";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Archives several tasks at once: the ones somebody picked, or everything in
 * one column of the board.
 *
 * Two bodies, one route, because it is one act — cards leave the board and
 * keep their history — and one route is one place that says who may do it.
 * `taskIds` names the tasks the bar picked. `propertyId` and `value` name a
 * column, and never a column id, because the server has no idea what a column
 * is: a column *is* one value of the property the view groups by, and
 * `columnIdForValue` is the same answer the board itself draws with. It also
 * answers the column that holds the tasks with no value at all: that one is
 * `value: null`.
 *
 * It is `humanOnly` for both. One call here can clear forty cards off the
 * board, and taking a handful of tasks off it is a decision about the board
 * rather than work on a task. An agent archives the one task it finished,
 * through the task route.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);
  humanOnly(user);

  const input = await body<{ taskIds?: unknown; propertyId?: unknown; value?: unknown }>(req);
  const read = readArchiveAsk(input);
  if (!read.ok) throw new HttpError(400, read.said);

  const ids =
    read.ask.kind === "tasks"
      ? await namedTasks(projectId, read.ask.ids)
      : await columnTasks(projectId, read.ask.propertyId, read.ask.value);

  /* One statement, and it names the state it changes from, exactly as
     archiving one task does. Only a row that really moved comes back, so a
     task that was already archived keeps the moment it first went and is
     counted out of the answer. That is what makes a retry free. */
  const archived = ids.length
    ? await db
        .update(tasks)
        .set({ archivedAt: new Date() })
        .where(and(inArray(tasks.id, ids), isNull(tasks.archivedAt)))
        .returning({ id: tasks.id })
    : [];

  if (archived.length) {
    /* One line on each task, exactly as archiving one task writes one line:
       the history of a task says what happened to it, however it happened.
       Through the funnel, and not by hand: a line written past it rings no
       webhook, and cards leaving the board is a change worth hearing about. */
    await logActivityAll(
      archived.map(({ id }) => ({
        projectId,
        taskId: id,
        actorId: user.id,
        kind: "archive",
        data: { action: "archived" },
      })),
    );
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  }

  return json({ archived: archived.length });
});

/**
 * The tasks the caller named, once every one of them is this board's.
 *
 * A bad id refuses the whole call rather than archiving the rest: the answer
 * is a count, and a count that says two where three were named tells nobody
 * which one stayed. An already archived task is not a bad id — the call says
 * what those tasks should be, and they already are.
 */
async function namedTasks(projectId: string, ids: string[]): Promise<string[]> {
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, ids), isNull(tasks.deletedAt)));

  const said = onBoardSaid(ids, rows);
  if (said) throw new HttpError(400, said);
  return ids;
}

/** Every live task whose value puts it in the column the body names. */
async function columnTasks(
  projectId: string,
  propertyId: string,
  value: unknown,
): Promise<string[]> {
  const property = await loadProperty(propertyId);
  if (property.projectId !== projectId) {
    throw new HttpError(400, "That property is not in this project.");
  }
  const wanted = columnIdForValue(await coerceValue(property, value), property);

  /* A task with no row for this property is in the "no value" column, so the
     join is a left one and the filtering happens here rather than in SQL. */
  const rows = await db
    .select({ id: tasks.id, value: taskValues.value })
    .from(tasks)
    .leftJoin(
      taskValues,
      and(eq(taskValues.taskId, tasks.id), eq(taskValues.propertyId, property.id)),
    )
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt), isNull(tasks.deletedAt)));

  return rows
    .filter((r) => columnIdForValue(r.value as TaskValue, property) === wanted)
    .map((r) => r.id);
}
