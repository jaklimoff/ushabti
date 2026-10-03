import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { projects, properties, propertyOptions, tasks, taskValues } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { logActivityIn, type ActivityEntry, type Ring } from "@/lib/activity";
import { adminOnly, body, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { readDoneWhen } from "@/lib/links";
import { loadProperties, optionPropertyId, withProjectLock } from "@/lib/queries";
import { nextOptionOf, readShipRest, shipDay, splitShip } from "@/lib/ship";
import type { TaskValue } from "@/lib/types";
import { isSelect } from "@/lib/types";

type Ctx = { params: Promise<{ optionId: string }> };

/**
 * Ships one column: the release or the sprint an option of a select stands for.
 *
 * The tasks in it that are over are archived, the rest go where the body says
 * — to the next option, nowhere, or out of the property — and the option
 * writes the day it shipped. It is one act, so it is one transaction under the
 * project lock, one bell on the stream and one webhook: every feed line it
 * writes carries the same `shipId`, as the lines of one import share theirs.
 *
 * It is `adminOnly`, which is `humanOnly` too. One press here clears a whole
 * column and closes an option everybody shares, which is a decision about the
 * board, never work on a task.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { optionId } = await ctx.params;
  const owner = await optionPropertyId(optionId);
  if (!owner) throw new HttpError(404, "Option not found.");
  const { projectId, propertyId } = owner;
  const { user, membership } = await guard(projectId);
  adminOnly(user, membership, "ship a column");

  const read = readShipRest(await body<{ rest?: unknown }>(req));
  if ("error" in read) throw new HttpError(400, read.error);
  const { rest } = read;

  const shipId = randomUUID();
  const { answer, ring } = await withProjectLock(projectId, async (tx) => {
    const [option] = await tx
      .select({
        name: propertyOptions.name,
        targetAt: propertyOptions.targetAt,
        shippedAt: propertyOptions.shippedAt,
        type: properties.type,
        property: properties.name,
      })
      .from(propertyOptions)
      .innerJoin(properties, eq(properties.id, propertyOptions.propertyId))
      .where(eq(propertyOptions.id, optionId))
      .limit(1);
    if (!option) throw new HttpError(404, "Option not found.");
    if (!isSelect(option.type) || !option.targetAt) {
      throw new HttpError(400, "Only an option with a target date can ship.");
    }
    /* A second press, or a second tab, must not archive what the first one
       moved into the next column. */
    if (option.shippedAt) {
      throw new HttpError(409, `${option.name} already shipped on ${option.shippedAt}.`);
    }

    const siblings = await tx
      .select({ id: propertyOptions.id, name: propertyOptions.name })
      .from(propertyOptions)
      .where(eq(propertyOptions.propertyId, propertyId))
      .orderBy(byPos(propertyOptions.position));
    const next = nextOptionOf(siblings, optionId);
    if (rest === "next" && !next) {
      throw new HttpError(
        400,
        `${option.name} is the last option, so there is nothing to move to.`,
      );
    }

    const column = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(
        taskValues,
        and(eq(taskValues.taskId, tasks.id), eq(taskValues.propertyId, propertyId)),
      )
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.archivedAt),
          isNull(tasks.deletedAt),
          sql`${taskValues.value} = ${JSON.stringify(optionId)}::jsonb`,
        ),
      );
    const ids = column.map((t) => t.id);

    /* Over is the project's rule, read afresh as every other reader does. */
    const [project] = await tx
      .select({ doneWhen: projects.doneWhen })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const doneWhen = readDoneWhen(project?.doneWhen, await loadProperties(projectId, tx));
    const held = new Map<string, TaskValue>();
    if (doneWhen && ids.length) {
      const rows = await tx
        .select({ taskId: taskValues.taskId, value: taskValues.value })
        .from(taskValues)
        .where(
          and(inArray(taskValues.taskId, ids), eq(taskValues.propertyId, doneWhen.propertyId)),
        );
      for (const row of rows) held.set(row.taskId, row.value as TaskValue);
    }
    const split = splitShip(
      ids.map((id) => ({
        id,
        archivedAt: null,
        values: doneWhen ? { [doneWhen.propertyId]: held.get(id) ?? null } : {},
      })),
      doneWhen,
    );

    /* A value written to one task takes no project lock, so a card can leave
       the column between the read and these writes. Each write names the
       state it changes from, and only the rows that really changed are
       counted and written in the feed. */
    const inColumn = sql`${taskValues.value} = ${JSON.stringify(optionId)}::jsonb`;
    const stillHere = sql`exists (select 1 from ${taskValues}
      where ${taskValues.taskId} = ${tasks.id}
        and ${taskValues.propertyId} = ${propertyId}
        and ${inColumn})`;
    const now = new Date();
    const archived = split.over.length
      ? (
          await tx
            .update(tasks)
            .set({ archivedAt: now })
            .where(and(inArray(tasks.id, split.over), isNull(tasks.archivedAt), stillHere))
            .returning({ id: tasks.id })
        ).map((r) => r.id)
      : [];
    const asked = rest === "leave" ? [] : split.rest;
    const to = rest === "next" ? next!.id : null;
    const moved = asked.length
      ? (
          await tx
            .update(taskValues)
            .set({ value: to })
            .where(
              and(
                eq(taskValues.propertyId, propertyId),
                inArray(taskValues.taskId, asked),
                inColumn,
              ),
            )
            .returning({ id: taskValues.taskId })
        ).map((r) => r.id)
      : [];
    if (moved.length) {
      await tx.update(tasks).set({ updatedAt: now }).where(inArray(tasks.id, moved));
    }
    const shippedAt = shipDay(now);
    await tx.update(propertyOptions).set({ shippedAt }).where(eq(propertyOptions.id, optionId));

    /* The line on each task says what happened to it, as if somebody had
       done it by hand; the line on the project carries the counts. */
    const line = { projectId, actorId: user.id };
    const entries: ActivityEntry[] = [
      ...archived.map((taskId) => ({
        ...line,
        taskId,
        kind: "archive",
        data: { action: "archived", shipId, option: option.name },
      })),
      ...moved.map((taskId) => ({
        ...line,
        taskId,
        kind: "value",
        data: {
          property: option.property,
          propertyId,
          value: next && to ? next.name : "empty",
          shipId,
        },
      })),
      {
        ...line,
        taskId: null,
        kind: "archive",
        data: {
          action: "shipped",
          shipId,
          option: option.name,
          optionId,
          archived: archived.length,
          rest,
          moved: moved.length,
        },
      },
    ];
    const ring: Ring = await logActivityIn(tx, entries);
    return {
      answer: { archived: archived.length, moved: moved.length, rest, shippedAt },
      ring,
    };
  });

  await ring();
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json(answer);
});
