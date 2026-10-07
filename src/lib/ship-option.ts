import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { projects, properties, propertyOptions, tasks, taskValues } from "@/db/schema";
import { byPos } from "@/lib/order";
import type { ActivityEntry, Ring } from "./activity";
import { dropHidden, lockTasks } from "./hidden";
import { HttpError } from "./auth";
import { readCadence, sprintAfter } from "./cadence";
import { nextPaletteColor } from "./colors";
import { todayIn } from "./day";
import { readDoneWhen } from "./links";
import { rankAfter } from "./rank";
import { loadProperties, type Tx } from "./queries";
import { closes, nextOpenOption, shipDay, splitShip, type ShipDone, type ShipRest } from "./ship";
import type { TaskValue } from "./types";
import { isSelect } from "./types";

/**
 * Ships one column inside the caller's transaction, which already holds the
 * project lock. Only a press of Ship comes here: a sprint past its end stays
 * open until somebody says it is over, as a release does. A sprint closes
 * rather than ships: its finished tasks stay where they are, because the same
 * task may still wait for a release.
 */
export async function shipOptionIn(
  tx: Tx,
  a: {
    projectId: string;
    propertyId: string;
    optionId: string;
    rest: ShipRest;
    actorId: string;
  },
): Promise<{ answer: ShipDone; ring: Ring }> {
  const { projectId, propertyId, optionId, rest } = a;
  const shipId = randomUUID();
  const [option] = await tx
    .select({
      name: propertyOptions.name,
      targetAt: propertyOptions.targetAt,
      shippedAt: propertyOptions.shippedAt,
      type: properties.type,
      config: properties.config,
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

  const options = () =>
    tx
      .select({
        id: propertyOptions.id,
        name: propertyOptions.name,
        color: propertyOptions.color,
        position: propertyOptions.position,
        startAt: propertyOptions.startAt,
        targetAt: propertyOptions.targetAt,
        shippedAt: propertyOptions.shippedAt,
      })
      .from(propertyOptions)
      .where(eq(propertyOptions.propertyId, propertyId))
      .orderBy(byPos(propertyOptions.position));
  let siblings = await options();

  /* An iteration with no open sprint after this one gets the next from its
     cadence, made here under the lock that also refuses a second ship: two
     presses cannot make two of it. The name and dates follow the last option. */
  const [project] = await tx
    .select({ doneWhen: projects.doneWhen, timeZone: projects.timeZone })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (option.type === "iteration") {
    const made = sprintAfter(
      siblings,
      optionId,
      readCadence(option.config as { cadence?: unknown }),
      todayIn(project?.timeZone ?? "UTC"),
    );
    if (made) {
      await tx.insert(propertyOptions).values({
        propertyId,
        ...made,
        color: nextPaletteColor(siblings.map((o) => o.color)),
        position: rankAfter(siblings.at(-1)?.position ?? null),
      });
      siblings = await options();
    }
  }
  const next = nextOpenOption(option, siblings, optionId);
  if (rest === "next" && !next) {
    throw new HttpError(400, `${option.name} is the last option, so there is nothing to move to.`);
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
  const doneWhen = readDoneWhen(project?.doneWhen, await loadProperties(projectId, tx));
  const held = new Map<string, TaskValue>();
  if (doneWhen && ids.length) {
    const rows = await tx
      .select({ taskId: taskValues.taskId, value: taskValues.value })
      .from(taskValues)
      .where(and(inArray(taskValues.taskId, ids), eq(taskValues.propertyId, doneWhen.propertyId)));
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
  const asked = rest === "leave" ? [] : split.rest;
  /* The tasks that move are locked before their values change, as every
     write that drops what it hides does. */
  await lockTasks(tx, asked);
  const archived =
    split.over.length && !closes(option)
      ? (
          await tx
            .update(tasks)
            .set({ archivedAt: now, updatedAt: now })
            .where(and(inArray(tasks.id, split.over), isNull(tasks.archivedAt), stillHere))
            .returning({ id: tasks.id })
        ).map((r) => r.id)
      : [];
  const to = rest === "next" ? next!.id : null;
  const moved = asked.length
    ? (
        await tx
          .update(taskValues)
          .set({ value: to })
          .where(
            and(eq(taskValues.propertyId, propertyId), inArray(taskValues.taskId, asked), inColumn),
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
  const line = { projectId, actorId: a.actorId };
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
        type: option.type,
        value: next && to ? next.name : "empty",
        shipId,
      },
    })),
    {
      ...line,
      taskId: null,
      kind: "archive",
      data: {
        action: closes(option) ? "closed" : "shipped",
        shipId,
        option: option.name,
        optionId,
        archived: archived.length,
        rest,
        moved: moved.length,
      },
    },
  ];
  /* A task moved to the next sprint, or to none, can stop showing what the
     old one showed. Its lines go with the ship's, so one ship rings once. */
  const { ring }: { ring: Ring } = await dropHidden(tx, {
    projectId,
    taskIds: moved,
    actorId: a.actorId,
    extra: { shipId },
    before: entries,
  });
  return { answer: { archived: archived.length, moved: moved.length, rest, shippedAt }, ring };
}
