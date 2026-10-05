import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  checklistItems,
  comments,
  projectInvites,
  projectMembers,
  projects,
  properties,
  propertyOptions,
  taskLinks,
  taskValues,
  tasks,
  users,
  views,
} from "@/db/schema";
import { mainBoardGroupById, ownCardView, readCardView } from "./card-view";
import { readTimeZone, todayIn } from "./day";
import { readFilters } from "./filters";
import { HttpError } from "./auth";
import { BLOCKS, PARENT, readDoneWhen, type DoneWhen } from "./links";
import { readProgressBy } from "./progress";
import { byPos } from "./order";
import { readSort } from "./sort";
import { readWhens } from "./when";
import { optionColumns, toOptionDTO } from "./queries";
import { VIEW_KINDS } from "./types";
import type {
  CardView,
  PropertyDTO,
  PropertyType,
  TaskValue,
  ViewFilters,
  ViewKind,
  ViewSort,
} from "./types";

/**
 * The whole project as one file, for a team that wants its work out.
 *
 * Every field is picked by name, never spread from a row: a column added to a
 * table later must not reach the file by accident, and a user row carries a
 * password hash. Tokens, sessions, resets and webhooks are never read at all.
 *
 * The activity feed and the runs stay out. The feed has no limit, and
 * `/activity` already reads it.
 */
export type ProjectExport = {
  format: "ushabti-export";
  version: 1;
  exportedAt: string;
  project: {
    name: string;
    key: string;
    timeZone: string;
    cardView: CardView;
    doneWhen: DoneWhen | null;
    progressBy: string | null;
  };
  properties: PropertyDTO[];
  views: {
    id: string;
    name: string;
    kind: ViewKind;
    groupById: string | null;
    position: string;
    isDefault: boolean;
    filters: ViewFilters;
    sort: ViewSort | null;
    /** The view's own card view, or null where it draws the project's. */
    cardView: CardView | null;
  }[];
  members: {
    id: string;
    name: string;
    email: string | null;
    kind: "human" | "agent";
    role: string;
    color: string;
  }[];
  invites: { email: string }[];
  tasks: {
    id: string;
    key: string;
    number: number;
    title: string;
    description: string;
    rank: string;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
    values: Record<string, TaskValue>;
    checklist: { text: string; done: boolean }[];
    comments: {
      authorId: string | null;
      body: string;
      createdAt: string;
      editedAt: string | null;
    }[];
    blockedBy: string[];
    /** The key of the task this one is part of. Its parts name it the same way. */
    parent: string | null;
  }[];
};

/** `ushabti-USH-2026-09-29.json`, the day being the project's own. */
export function exportFileName(key: string, timeZone: string, now: Date): string {
  return `ushabti-${key}-${todayIn(readTimeZone(timeZone), now)}.json`;
}

/**
 * Reads the project in a fixed number of queries, whatever its size: one per
 * table, never one per task. A task that was deleted is not in the file, and
 * neither is anything that hangs off one.
 */
export async function loadExport(
  projectId: string,
  now: Date = new Date(),
): Promise<ProjectExport> {
  const [projectRow] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!projectRow) throw new HttpError(404, "That project does not exist.");

  /* Every per-task table is joined to its task, so a row of a deleted task
     never comes back. */
  const kept = and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt));

  const [
    memberRows,
    inviteRows,
    propRows,
    optRows,
    viewRows,
    taskRows,
    valueRows,
    checklistRows,
    commentRows,
    linkRows,
  ] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        kind: users.kind,
        color: users.color,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(users.name)),
    db
      .select({ email: projectInvites.email })
      .from(projectInvites)
      .where(eq(projectInvites.projectId, projectId))
      .orderBy(asc(projectInvites.createdAt)),
    db
      .select()
      .from(properties)
      .where(eq(properties.projectId, projectId))
      .orderBy(byPos(properties.position)),
    db
      .select(optionColumns)
      .from(propertyOptions)
      .innerJoin(properties, eq(properties.id, propertyOptions.propertyId))
      .where(eq(properties.projectId, projectId))
      .orderBy(byPos(propertyOptions.position)),
    db.select().from(views).where(eq(views.projectId, projectId)).orderBy(byPos(views.position)),
    db
      .select({
        id: tasks.id,
        number: tasks.number,
        title: tasks.title,
        description: tasks.description,
        position: tasks.position,
        createdBy: tasks.createdBy,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        archivedAt: tasks.archivedAt,
      })
      .from(tasks)
      .where(kept)
      .orderBy(byPos(tasks.position), asc(tasks.number)),
    db
      .select({
        taskId: taskValues.taskId,
        propertyId: taskValues.propertyId,
        value: taskValues.value,
      })
      .from(taskValues)
      .innerJoin(tasks, eq(tasks.id, taskValues.taskId))
      .where(kept),
    db
      .select({
        taskId: checklistItems.taskId,
        text: checklistItems.text,
        done: checklistItems.done,
      })
      .from(checklistItems)
      .innerJoin(tasks, eq(tasks.id, checklistItems.taskId))
      .where(kept)
      .orderBy(byPos(checklistItems.position)),
    db
      .select({
        taskId: comments.taskId,
        authorId: comments.authorId,
        body: comments.body,
        createdAt: comments.createdAt,
        editedAt: comments.editedAt,
      })
      .from(comments)
      .innerJoin(tasks, eq(tasks.id, comments.taskId))
      .where(kept)
      .orderBy(asc(comments.createdAt)),
    /* Joined on the task that waits, or the part. The other end is checked
       below against the tasks this file holds, so a deleted one is not
       named. One read carries both kinds; the kind sorts them apart. */
    db
      .select({ fromId: taskLinks.fromId, toId: taskLinks.toId, kind: taskLinks.kind })
      .from(taskLinks)
      .innerJoin(tasks, eq(tasks.id, taskLinks.toId))
      .where(kept),
  ]);

  const propertyList: PropertyDTO[] = readWhens(
    propRows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type as PropertyType,
      position: p.position,
      config: (p.config ?? {}) as PropertyDTO["config"],
      options: optRows.filter((o) => o.propertyId === p.id).map(toOptionDTO),
    })),
  );

  const key = (n: number) => `${projectRow.key}-${n}`;
  const numberOf = new Map(taskRows.map((t) => [t.id, t.number]));

  const valuesOf = new Map<string, Record<string, TaskValue>>();
  for (const v of valueRows) {
    const bag = valuesOf.get(v.taskId) ?? {};
    bag[v.propertyId] = v.value as TaskValue;
    valuesOf.set(v.taskId, bag);
  }
  const checklistOf = groupBy(checklistRows, (c) => ({ text: c.text, done: c.done }));
  const commentsOf = groupBy(commentRows, (c) => ({
    authorId: c.authorId,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt ? c.editedAt.toISOString() : null,
  }));
  const blockersOf = new Map<string, number[]>();
  const parentOf = new Map<string, number>();
  for (const link of linkRows) {
    const n = numberOf.get(link.fromId);
    if (n === undefined) continue;
    if (link.kind === PARENT) {
      parentOf.set(link.toId, n);
      continue;
    }
    if (link.kind !== BLOCKS) continue;
    blockersOf.set(link.toId, [...(blockersOf.get(link.toId) ?? []), n]);
  }

  return {
    format: "ushabti-export",
    version: 1,
    exportedAt: now.toISOString(),
    project: {
      name: projectRow.name,
      key: projectRow.key,
      timeZone: readTimeZone(projectRow.timeZone),
      cardView: readCardView(projectRow.cardView, propertyList, mainBoardGroupById(viewRows)),
      doneWhen: readDoneWhen(projectRow.doneWhen, propertyList),
      progressBy: readProgressBy(projectRow.progressBy, propertyList),
    },
    properties: propertyList,
    /* The team's rules and order only. A lens is one person's, and stays. */
    views: viewRows.map((v) => {
      const config = (v.config ?? {}) as { filters?: unknown; sort?: unknown };
      return {
        id: v.id,
        name: v.name,
        kind: (VIEW_KINDS as readonly string[]).includes(v.kind) ? (v.kind as ViewKind) : "board",
        groupById: v.groupById,
        position: v.position,
        isDefault: v.isDefault,
        filters: readFilters(config.filters, propertyList),
        sort: readSort(config.sort, propertyList),
        cardView: ownCardView(v.cardView, propertyList),
      };
    }),
    members: memberRows.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      kind: m.kind === "agent" ? "agent" : "human",
      role: m.role,
      color: m.color,
    })),
    invites: inviteRows.map((i) => ({ email: i.email })),
    tasks: taskRows.map((t) => ({
      id: t.id,
      key: key(t.number),
      number: t.number,
      title: t.title,
      description: t.description,
      rank: t.position,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
      values: valuesOf.get(t.id) ?? {},
      checklist: checklistOf.get(t.id) ?? [],
      comments: commentsOf.get(t.id) ?? [],
      blockedBy: (blockersOf.get(t.id) ?? []).sort((a, b) => a - b).map(key),
      parent: parentOf.has(t.id) ? key(parentOf.get(t.id)!) : null,
    })),
  };
}

function groupBy<R extends { taskId: string }, T>(rows: R[], pick: (row: R) => T) {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.taskId);
    if (list) list.push(pick(row));
    else out.set(row.taskId, [pick(row)]);
  }
  return out;
}
