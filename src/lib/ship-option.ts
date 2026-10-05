import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, projects, properties, propertyOptions, tasks, taskValues } from "@/db/schema";
import { byPos } from "@/lib/order";
import type { ActivityEntry, Ring } from "./activity";
import { dropHidden, lockTasks } from "./hidden";
import { HttpError } from "./auth";
import { readCadence, sprintsAhead } from "./cadence";
import { nextPaletteColor } from "./colors";
import { readTimeZone, todayIn } from "./day";
import { publish } from "./events";
import { readDoneWhen } from "./links";
import { rankAfter } from "./rank";
import { loadProperties, withProjectLock, type Tx } from "./queries";
import {
  movedWhenEnded,
  nextOpenOption,
  shipDay,
  splitShip,
  type ShipDone,
  type ShipRest,
} from "./ship";
import type { TaskValue } from "./types";
import { isSelect } from "./types";

/**
 * Ships one column inside the caller's transaction, which already holds the
 * project lock. A press of Ship and a roll on the read both come here, so an
 * archive and a move are written one way only.
 *
 * `actorId` is null for a roll: the project did it, not a person and not an
 * agent. A roll also dates the option by its own target, because that is the
 * day it ended, and leaves one comment on each task it moved.
 */
export async function shipOptionIn(
  tx: Tx,
  a: {
    projectId: string;
    propertyId: string;
    optionId: string;
    rest: ShipRest;
    actorId: string | null;
    rolled: boolean;
  },
): Promise<{ answer: ShipDone; ring: Ring }> {
  const { projectId, propertyId, optionId, rest, rolled } = a;
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

  /* An iteration keeps its cadence's sprints open ahead, so the next one is
     made here, under the lock that also refuses a second ship: two presses
     cannot make two of it. The names and dates follow the last option. */
  const [project] = await tx
    .select({ doneWhen: projects.doneWhen, timeZone: projects.timeZone })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (option.type === "iteration") {
    const made = sprintsAhead(
      siblings,
      optionId,
      readCadence(option.config as { cadence?: unknown }),
      todayIn(project?.timeZone ?? "UTC"),
    );
    let rank = siblings.at(-1)?.position ?? null;
    const colors = siblings.map((o) => o.color);
    for (const sprint of made) {
      rank = rankAfter(rank);
      const color = nextPaletteColor(colors);
      colors.push(color);
      await tx.insert(propertyOptions).values({ propertyId, ...sprint, color, position: rank });
    }
    if (made.length) siblings = await options();
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
  const archived = split.over.length
    ? (
        await tx
          .update(tasks)
          .set({ archivedAt: now })
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
  const shippedAt = rolled ? option.targetAt : shipDay(now);
  await tx
    .update(propertyOptions)
    .set({ shippedAt, rolled })
    .where(eq(propertyOptions.id, optionId));

  /* A task that moved by itself says so on the task, where somebody looking
     for it will read. */
  const said =
    rolled && next && to && moved.length
      ? await tx
          .insert(comments)
          .values(
            moved.map((taskId) => ({
              taskId,
              authorId: null,
              byProject: true,
              body: movedWhenEnded(option.name, next.name),
            })),
          )
          .returning({ id: comments.id, taskId: comments.taskId })
      : [];

  /* The line on each task says what happened to it, as if somebody had
     done it by hand; the line on the project carries the counts. */
  const line = { projectId, actorId: a.actorId };
  const mark = rolled ? { rolled: true } : {};
  const entries: ActivityEntry[] = [
    ...archived.map((taskId) => ({
      ...line,
      taskId,
      kind: "archive",
      data: { action: "archived", shipId, option: option.name, ...mark },
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
        ...mark,
      },
    })),
    ...said.map((c) => ({
      ...line,
      taskId: c.taskId,
      kind: "comment",
      data: { commentId: c.id, shipId, ...mark },
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
        ...mark,
      },
    },
  ];
  /* A task moved to the next sprint, or to none, can stop showing what the
     old one showed. Its lines go with the ship's, so one ship rings once. */
  const { ring }: { ring: Ring } = await dropHidden(tx, {
    projectId,
    taskIds: moved,
    actorId: a.actorId,
    extra: { shipId, ...mark },
    before: entries,
  });
  return { answer: { archived: archived.length, moved: moved.length, rest, shippedAt }, ring };
}

/** At most this many sprints roll on one read, so a bad row cannot hold a read for ever. */
const ROLL_MAX = 60;

/**
 * Rolls every iteration whose target day is before today, in the project's
 * time: what is over is archived, the rest moves to the next sprint.
 *
 * The server has no clock of its own, so the board read is the clock, as it
 * is for the lease. A cheap read outside the lock asks whether there is
 * anything to do; the roll itself reads again under the lock, so two reads in
 * the same second roll an option once. A board left alone for a month rolls
 * one sprint after another until the current one is reached.
 *
 * A failed roll must not take the board down with it, so it is reported and
 * the read goes on. Nothing of it is written: it is one transaction.
 */
export async function rollEnded(projectId: string): Promise<void> {
  const [project] = await db
    .select({ timeZone: projects.timeZone })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return;
  const today = todayIn(readTimeZone(project.timeZone));
  const ended = (handle: Tx | typeof db) =>
    handle
      .select({ id: propertyOptions.id, propertyId: propertyOptions.propertyId })
      .from(propertyOptions)
      .innerJoin(properties, eq(properties.id, propertyOptions.propertyId))
      .where(
        and(
          eq(properties.projectId, projectId),
          // Only an iteration rolls. A version or an epic waits for a press.
          eq(properties.type, "iteration"),
          isNull(propertyOptions.shippedAt),
          // A person reopened it; the roll waits for a new target.
          eq(propertyOptions.keptOpen, false),
          lt(propertyOptions.targetAt, today),
        ),
      )
      .orderBy(asc(propertyOptions.targetAt), byPos(propertyOptions.position))
      .limit(1);
  if ((await ended(db)).length === 0) return;

  try {
    const rings = await withProjectLock(projectId, async (tx) => {
      const out: Ring[] = [];
      for (let i = 0; i < ROLL_MAX; i++) {
        const [option] = await ended(tx);
        if (!option) break;
        const { ring } = await shipOptionIn(tx, {
          projectId,
          propertyId: option.propertyId,
          optionId: option.id,
          rest: "next",
          actorId: null,
          rolled: true,
        });
        out.push(ring);
      }
      return out;
    });
    for (const ring of rings) await ring();
    if (rings.length) await publish({ projectId, scope: "board" });
  } catch (err) {
    console.error(`The sprint roll of project ${projectId} failed:`, err);
  }
}
