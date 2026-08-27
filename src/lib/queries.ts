import "server-only";
import { byPos } from "@/lib/order";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
  views,
} from "@/db/schema";
import { DEFAULT_PROPERTIES, DEFAULT_VIEWS } from "./defaults";
import { readFilters } from "./filters";
import { rankSequence } from "./rank";
import { loadOpenRuns, loadTaskRun } from "./runs";
import type {
  ActivityDTO,
  BoardData,
  ChecklistItemDTO,
  CommentDTO,
  MemberDTO,
  PropertyDTO,
  PropertyType,
  TaskDTO,
  TaskDetailDTO,
  TaskValue,
  ViewDTO,
} from "./types";

/* ------------------------------------------------------------------ */
/* Serialising the writes that compute a rank                          */
/* ------------------------------------------------------------------ */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Anything that reads its neighbours and then writes a rank has to do both
 * inside one transaction, or two writes at the same moment read the same
 * neighbour and produce the same rank. Locking the project row is enough:
 * every ordered list in the app belongs to exactly one project.
 */
export async function withProjectLock<T>(
  projectId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from ${projects} where ${projects.id} = ${projectId} for update`);
    return work(tx);
  });
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export async function listProjects(userId: string) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      key: projects.key,
      ownerId: projects.ownerId,
      role: projectMembers.role,
      createdAt: projects.createdAt,
      taskCount: sql<number>`(select count(*)::int from ${tasks} t where t.project_id = ${projects}.id)`,
      memberCount: sql<number>`(select count(*)::int from ${projectMembers} pm where pm.project_id = ${projects}.id)`,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.userId, userId))
    .orderBy(asc(projects.createdAt));
}

/** Creates the project, its default property set and its default views. */
export async function createProject(userId: string, name: string, key: string) {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ name, key: key.toUpperCase(), ownerId: userId })
      .returning();

    await tx.insert(projectMembers).values({
      projectId: project.id,
      userId,
      role: "owner",
    });

    const propRanks = rankSequence(DEFAULT_PROPERTIES.length);
    const byName = new Map<string, string>();

    for (let i = 0; i < DEFAULT_PROPERTIES.length; i += 1) {
      const def = DEFAULT_PROPERTIES[i];
      const [prop] = await tx
        .insert(properties)
        .values({
          projectId: project.id,
          name: def.name,
          type: def.type,
          position: propRanks[i],
          config: { showOnCard: def.showOnCard },
        })
        .returning({ id: properties.id });
      byName.set(def.name, prop.id);

      if (def.options?.length) {
        const optRanks = rankSequence(def.options.length);
        await tx.insert(propertyOptions).values(
          def.options.map((o, j) => ({
            propertyId: prop.id,
            name: o.name,
            color: o.color,
            position: optRanks[j],
          })),
        );
      }
    }

    const viewRanks = rankSequence(DEFAULT_VIEWS.length);
    await tx.insert(views).values(
      DEFAULT_VIEWS.map((v, i) => ({
        projectId: project.id,
        name: v.name,
        groupById: byName.get(v.groupBy) ?? null,
        position: viewRanks[i],
        isDefault: v.isDefault,
        config: {},
      })),
    );

    return project;
  });
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

type ViewRow = typeof views.$inferSelect;

/**
 * A view as the board sees it. The filters go through `readFilters`, so a rule
 * whose property or option was deleted never leaves this function. That is the
 * only cleanup there is: nothing rewrites a view when a property goes.
 */
export function toViewDTO(row: ViewRow, propertyList: PropertyDTO[]): ViewDTO {
  return {
    id: row.id,
    name: row.name,
    groupById: row.groupById,
    position: row.position,
    isDefault: row.isDefault,
    filters: readFilters((row.config as { filters?: unknown } | null)?.filters, propertyList),
  };
}

/** The properties of a project with their options, as the board sees them. */
export async function loadProperties(projectId: string): Promise<PropertyDTO[]> {
  const [propRows, optRows] = await Promise.all([
    db
      .select()
      .from(properties)
      .where(eq(properties.projectId, projectId))
      .orderBy(byPos(properties.position)),
    db
      .select({
        id: propertyOptions.id,
        propertyId: propertyOptions.propertyId,
        name: propertyOptions.name,
        color: propertyOptions.color,
        position: propertyOptions.position,
      })
      .from(propertyOptions)
      .innerJoin(properties, eq(properties.id, propertyOptions.propertyId))
      .where(eq(properties.projectId, projectId))
      .orderBy(byPos(propertyOptions.position)),
  ]);
  return withOptions(propRows, optRows);
}

type PropRow = typeof properties.$inferSelect;
type OptRow = { id: string; propertyId: string; name: string; color: string; position: string };

function withOptions(propRows: PropRow[], optRows: OptRow[]): PropertyDTO[] {
  const optionsByProp = new Map<string, PropertyDTO["options"]>();
  for (const o of optRows) {
    const list = optionsByProp.get(o.propertyId) ?? [];
    list.push({ id: o.id, name: o.name, color: o.color, position: o.position });
    optionsByProp.set(o.propertyId, list);
  }
  return propRows.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type as PropertyType,
    position: p.position,
    config: (p.config ?? {}) as PropertyDTO["config"],
    options: optionsByProp.get(p.id) ?? [],
  }));
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

export async function loadBoard(projectId: string, role: string): Promise<BoardData> {
  const [projectRow] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

  const [memberRows, propRows, optRows, viewRows, taskRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        color: users.color,
        kind: users.kind,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(users.name)),
    db
      .select()
      .from(properties)
      .where(eq(properties.projectId, projectId))
      .orderBy(byPos(properties.position)),
    db
      .select({
        id: propertyOptions.id,
        propertyId: propertyOptions.propertyId,
        name: propertyOptions.name,
        color: propertyOptions.color,
        position: propertyOptions.position,
      })
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
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        /* `${tasks.id}` writes a bare `"id"` in a selected column, and inside
           a subquery that name belongs to the inner table. The counts then
           compare a task to a comment and every card reads zero. Name the
           table. */
        checklistTotal: sql<number>`(select count(*)::int from ${checklistItems} ci where ci.task_id = ${tasks}.id)`,
        checklistDone: sql<number>`(select count(*)::int from ${checklistItems} ci where ci.task_id = ${tasks}.id and ci.done)`,
        commentCount: sql<number>`(select count(*)::int from ${comments} c where c.task_id = ${tasks}.id)`,
      })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      // the number keeps the order stable if two ranks ever match
      .orderBy(byPos(tasks.position), asc(tasks.number)),
  ]);

  const taskIds = taskRows.map((t) => t.id);
  const [valueRows, runs] = await Promise.all([
    taskIds.length
      ? db.select().from(taskValues).where(inArray(taskValues.taskId, taskIds))
      : Promise.resolve([]),
    loadOpenRuns(projectId),
  ]);

  const valuesByTask = new Map<string, Record<string, TaskValue>>();
  for (const v of valueRows) {
    const bag = valuesByTask.get(v.taskId) ?? {};
    bag[v.propertyId] = v.value as TaskValue;
    valuesByTask.set(v.taskId, bag);
  }

  const propertyList = withOptions(propRows, optRows);

  const viewList: ViewDTO[] = viewRows.map((v) => toViewDTO(v, propertyList));

  const taskList: TaskDTO[] = taskRows.map((t) => ({
    id: t.id,
    number: t.number,
    key: `${projectRow.key}-${t.number}`,
    title: t.title,
    description: t.description,
    position: t.position,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    values: valuesByTask.get(t.id) ?? {},
    checklistTotal: t.checklistTotal,
    checklistDone: t.checklistDone,
    commentCount: t.commentCount,
  }));

  const members: MemberDTO[] = memberRows.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    color: m.color,
    role: m.role,
    kind: m.kind === "agent" ? "agent" : "human",
  }));

  return {
    project: {
      id: projectRow.id,
      name: projectRow.name,
      key: projectRow.key,
      ownerId: projectRow.ownerId,
      role,
    },
    members,
    properties: propertyList,
    views: viewList,
    tasks: taskList,
    runs,
  };
}

/* ------------------------------------------------------------------ */
/* Task detail                                                         */
/* ------------------------------------------------------------------ */

export async function loadTaskDetail(taskId: string): Promise<TaskDetailDTO | null> {
  const [row] = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      description: tasks.description,
      position: tasks.position,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      projectKey: projects.key,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!row) return null;

  const [valueRows, checkRows, commentRows, activityRows, run] = await Promise.all([
    db.select().from(taskValues).where(eq(taskValues.taskId, taskId)),
    db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.taskId, taskId))
      .orderBy(byPos(checklistItems.position)),
    db
      .select({
        id: comments.id,
        body: comments.body,
        createdAt: comments.createdAt,
        authorId: users.id,
        authorName: users.name,
        authorColor: users.color,
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.taskId, taskId))
      .orderBy(asc(comments.createdAt)),
    db
      .select({
        id: activity.id,
        kind: activity.kind,
        data: activity.data,
        createdAt: activity.createdAt,
        actorId: users.id,
        actorName: users.name,
        actorColor: users.color,
      })
      .from(activity)
      .leftJoin(users, eq(users.id, activity.actorId))
      .where(eq(activity.taskId, taskId))
      .orderBy(desc(activity.createdAt))
      .limit(60),
    loadTaskRun(taskId),
  ]);

  const values: Record<string, TaskValue> = {};
  for (const v of valueRows) values[v.propertyId] = v.value as TaskValue;

  const checklist: ChecklistItemDTO[] = checkRows.map((c) => ({
    id: c.id,
    text: c.text,
    done: c.done,
    position: c.position,
  }));

  const commentList: CommentDTO[] = commentRows.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    author: c.authorId ? { id: c.authorId, name: c.authorName!, color: c.authorColor! } : null,
  }));

  const activityList: ActivityDTO[] = activityRows.map((a) => ({
    id: a.id,
    kind: a.kind,
    data: (a.data ?? {}) as Record<string, unknown>,
    createdAt: a.createdAt.toISOString(),
    actor: a.actorId ? { id: a.actorId, name: a.actorName!, color: a.actorColor! } : null,
  }));

  return {
    id: row.id,
    number: row.number,
    key: `${row.projectKey}-${row.number}`,
    title: row.title,
    description: row.description,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    values,
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((c) => c.done).length,
    commentCount: commentList.length,
    checklist,
    comments: commentList,
    activity: activityList,
    run,
  };
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

export async function logActivity(entry: {
  projectId: string;
  taskId?: string | null;
  actorId: string;
  kind: string;
  data?: Record<string, unknown>;
}) {
  await db.insert(activity).values({
    projectId: entry.projectId,
    taskId: entry.taskId ?? null,
    actorId: entry.actorId,
    kind: entry.kind,
    data: entry.data ?? {},
  });
}

export async function taskProjectId(taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.projectId ?? null;
}

export async function propertyProjectId(propertyId: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: properties.projectId })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return row?.projectId ?? null;
}

export async function optionPropertyId(optionId: string) {
  const [row] = await db
    .select({ propertyId: propertyOptions.propertyId, projectId: properties.projectId })
    .from(propertyOptions)
    .innerJoin(properties, eq(properties.id, propertyOptions.propertyId))
    .where(eq(propertyOptions.id, optionId))
    .limit(1);
  return row ?? null;
}

export async function viewProjectId(viewId: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: views.projectId })
    .from(views)
    .where(eq(views.id, viewId))
    .limit(1);
  return row?.projectId ?? null;
}

export async function checklistTaskId(itemId: string): Promise<string | null> {
  const [row] = await db
    .select({ taskId: checklistItems.taskId })
    .from(checklistItems)
    .where(eq(checklistItems.id, itemId))
    .limit(1);
  return row?.taskId ?? null;
}

export async function commentRow(commentId: string) {
  const [row] = await db
    .select({ id: comments.id, taskId: comments.taskId, authorId: comments.authorId })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  return row ?? null;
}

export { and, eq };
