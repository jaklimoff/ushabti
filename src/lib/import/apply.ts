import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  checklistItems,
  comments,
  projectMembers,
  projects,
  properties,
  propertyOptions,
  taskValues,
  tasks,
  users,
} from "@/db/schema";
import { byPos } from "@/lib/order";
import { nextPaletteColor } from "@/lib/colors";
import { rankAfter, rankSequence } from "@/lib/rank";
import { defaultGroupById, loadProperties, withProjectLock, type Tx } from "@/lib/queries";
import { logActivityAll, type ActivityEntry } from "@/lib/activity";
import type { ImportMadeDTO } from "@/lib/types";
import type { Plan, PlanProperty, ProjectShape } from "./plan";
import { SOURCE } from "./trello";

/**
 * Writing a whole board, once.
 *
 * Everything here happens inside one `withProjectLock`: the counter is raised
 * by the number of cards in one statement, the ranks are worked out from one
 * read of the last task, and the rows go in set by set. Two thousand cards
 * written one route call at a time would raise the counter two thousand times
 * and ring two thousand doorbells, and a board half imported is worse than
 * one not imported at all.
 *
 * The feed is what makes an import repeatable. Every task gets one `import`
 * line naming the card it came from, and the next import reads those lines
 * first and leaves those cards alone. There is no import table: the feed is
 * the record, here as everywhere.
 */

/** How many rows one statement carries. */
export const BATCH = 500;

function batches<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

/**
 * The board as it is today, for the plan to read.
 *
 * The `already` set is this project's own memory of what it has taken: one
 * read of the `import` lines, which is the only place a card's Trello id is
 * ever written down.
 */
export async function projectShape(projectId: string): Promise<ProjectShape> {
  const [propertyRows, memberRows, groupPropertyId, importLines] = await Promise.all([
    loadProperties(projectId),
    db
      .select({ id: users.id, name: users.name })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId)),
    defaultGroupById(projectId),
    db
      .select({ data: activity.data })
      .from(activity)
      .where(and(eq(activity.projectId, projectId), eq(activity.kind, "import"))),
  ]);

  const already = new Set<string>();
  for (const line of importLines) {
    const data = (line.data ?? {}) as { source?: unknown; sourceId?: unknown };
    if (data.source === SOURCE && typeof data.sourceId === "string") already.add(data.sourceId);
  }

  return {
    properties: propertyRows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      options: p.options.map((o) => ({ id: o.id, name: o.name })),
    })),
    members: memberRows,
    groupPropertyId,
    already,
  };
}

/**
 * Makes the property this plan needs, or answers the one it found.
 *
 * A board that never had a Due date gets one the moment a file carries due
 * dates, and an ordinary property at that: the owner can rename it, move it
 * or delete it afterwards. Nothing about a task is hardcoded, so an import
 * cannot write a field — it can only add a property and fill it in.
 */
async function ensureProperty(
  tx: Tx,
  projectId: string,
  want: PlanProperty,
  type: string,
): Promise<string> {
  if (want.id) return want.id;
  const last = await tx
    .select({ position: properties.position })
    .from(properties)
    .where(eq(properties.projectId, projectId))
    .orderBy(byPos(properties.position));
  const [row] = await tx
    .insert(properties)
    .values({
      projectId,
      name: want.name,
      type,
      position: rankAfter(last.at(-1)?.position ?? null),
      config: {},
    })
    .returning({ id: properties.id });
  return row.id;
}

/** Adds the options a plan asks for, each one after the ones already there. */
async function addOptions(
  tx: Tx,
  propertyId: string,
  names: string[],
): Promise<Map<string, string>> {
  const made = new Map<string, string>();
  if (names.length === 0) return made;

  const siblings = await tx
    .select({ color: propertyOptions.color, position: propertyOptions.position })
    .from(propertyOptions)
    .where(eq(propertyOptions.propertyId, propertyId))
    .orderBy(byPos(propertyOptions.position));

  const used = siblings.map((s) => s.color);
  let position = siblings.at(-1)?.position ?? null;
  const rows = names.map((name) => {
    position = rankAfter(position);
    const color = nextPaletteColor(used);
    used.push(color);
    return { id: randomUUID(), propertyId, name, color, position };
  });

  for (const batch of batches(rows)) await tx.insert(propertyOptions).values(batch);
  for (let at = 0; at < names.length; at += 1) made.set(names[at], rows[at].id);
  return made;
}

/**
 * Writes the plan, and answers what it made.
 *
 * Nothing is written when the plan carries no task: an import of a file this
 * board already holds must not add an empty column, and pressing **Import**
 * twice has to be the same as pressing it once.
 */
export async function applyImport(input: {
  projectId: string;
  actorId: string;
  plan: Plan;
}): Promise<ImportMadeDTO> {
  const { projectId, actorId, plan } = input;
  const importId = randomUUID();
  if (plan.tasks.length === 0) {
    return { importId, tasks: 0, options: 0, already: plan.already };
  }

  const made = await withProjectLock(projectId, async (tx) => {
    const groupId = await ensureProperty(tx, projectId, plan.group, "select");
    /* A list is a column, so every list comes, empty or not: a board has to
       arrive looking like the board it left. A label nobody put on a card is
       not on the board at all, so it is not made. */
    const listOptions = await addOptions(
      tx,
      groupId,
      plan.lists.filter((l) => l.making).map((l) => l.name),
    );
    const optionOfList = new Map<string, string>();
    for (const list of plan.lists) {
      const id = list.optionId ?? listOptions.get(list.name);
      if (id) optionOfList.set(list.sourceId, id);
    }

    const wornLabels = plan.labels.filter((l) => l.cards > 0);
    const optionOfLabel = new Map<string, string>();
    let labelsId: string | null = null;
    if (wornLabels.length) {
      labelsId = await ensureProperty(tx, projectId, plan.labelsProperty, "multi_select");
      const labelOptions = await addOptions(
        tx,
        labelsId,
        wornLabels.filter((l) => l.making).map((l) => l.name),
      );
      for (const label of wornLabels) {
        const id = label.optionId ?? labelOptions.get(label.name);
        if (id) optionOfLabel.set(label.sourceId, id);
      }
    }

    const wantsDue = plan.tasks.some((t) => t.due !== null);
    const dueId = wantsDue ? await ensureProperty(tx, projectId, plan.dueProperty, "date") : null;
    const wantsAssignee = plan.tasks.some((t) => t.assigneeId !== null);
    const assigneeId = wantsAssignee
      ? await ensureProperty(tx, projectId, plan.assigneeProperty, "person")
      : null;

    /* One raise for the whole file. The numbers that come back are the last
       N, so the first card of the file takes the first of them. */
    const [project] = await tx
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + ${plan.tasks.length}` })
      .where(eq(projects.id, projectId))
      .returning({ counter: projects.taskCounter, key: projects.key });
    const first = project.counter - plan.tasks.length + 1;

    const last = await tx
      .select({ position: tasks.position })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(byPos(tasks.position));
    let position = last.at(-1)?.position ?? null;

    const now = new Date();
    const rows = plan.tasks.map((task, at) => {
      position = rankAfter(position);
      return {
        id: randomUUID(),
        projectId,
        number: first + at,
        title: task.title,
        description: task.description,
        position,
        createdBy: actorId,
        /* An archived card comes in archived. It is a mark on the row and not
           a property, exactly as it is for a card archived here. */
        archivedAt: task.archived ? now : null,
      };
    });
    for (const batch of batches(rows)) await tx.insert(tasks).values(batch);

    const values: (typeof taskValues.$inferInsert)[] = [];
    const checks: (typeof checklistItems.$inferInsert)[] = [];
    const notes: (typeof comments.$inferInsert)[] = [];
    for (let at = 0; at < plan.tasks.length; at += 1) {
      const task = plan.tasks[at];
      const taskId = rows[at].id;
      const option = optionOfList.get(task.listId);
      if (option) values.push({ taskId, propertyId: groupId, value: option });
      if (labelsId) {
        const worn = task.labelIds
          .map((id) => optionOfLabel.get(id))
          .filter((id): id is string => id !== undefined);
        if (worn.length) values.push({ taskId, propertyId: labelsId, value: worn });
      }
      if (dueId && task.due) values.push({ taskId, propertyId: dueId, value: task.due });
      if (assigneeId && task.assigneeId) {
        values.push({ taskId, propertyId: assigneeId, value: task.assigneeId });
      }

      const ranks = rankSequence(task.checklist.length);
      task.checklist.forEach((item, i) => {
        checks.push({ taskId, text: item.text, done: item.done, position: ranks[i] });
      });
      /* Oldest first, and one millisecond apart, so the panel draws them in
         the order they were written rather than in whatever order one
         statement's rows come back in. */
      task.comments.forEach((comment, i) => {
        notes.push({
          taskId,
          authorId: actorId,
          body: comment.body,
          createdAt: new Date(now.getTime() + i),
        });
      });
    }

    for (const batch of batches(values)) await tx.insert(taskValues).values(batch);
    for (const batch of batches(checks)) await tx.insert(checklistItems).values(batch);
    for (const batch of batches(notes)) await tx.insert(comments).values(batch);

    return {
      rows,
      /* Only the options this import added. One that matched a name the board
         already had is not something it made. */
      options: listOptions.size + wornLabels.filter((l) => l.making).length,
    };
  });

  /* One line on the project and one on each task, all naming this import, so
     `logActivityAll` writes them in one statement and the webhooks ring once.
     The project line goes first: it is the one a doorbell carries. */
  const entries: ActivityEntry[] = [
    {
      projectId,
      taskId: null,
      actorId,
      kind: "import",
      data: {
        importId,
        source: plan.source,
        board: plan.board,
        tasks: plan.tasks.length,
        options: made.options,
        already: plan.already,
      },
    },
    ...plan.tasks.map((task, at) => ({
      projectId,
      taskId: made.rows[at].id,
      actorId,
      kind: "import",
      data: {
        importId,
        source: plan.source,
        sourceId: task.sourceId,
        sourceKey: task.sourceKey,
        board: plan.board,
      },
    })),
  ];
  await logActivityAll(entries);

  return {
    importId,
    tasks: plan.tasks.length,
    options: made.options,
    already: plan.already,
  };
}
