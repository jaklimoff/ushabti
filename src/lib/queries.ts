import "server-only";
import { byPos } from "@/lib/order";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  agentTokens,
  checklistItems,
  comments,
  projectInvites,
  projectMembers,
  projects,
  properties,
  propertyOptions,
  taskValues,
  tasks,
  users,
  viewLenses,
  views,
} from "@/db/schema";
import { HttpError } from "./auth";
import { readCardView } from "./card-view";
import { DEFAULT_PROPERTIES, DEFAULT_VIEWS } from "./defaults";
import { readFilters } from "./filters";
import { readSort } from "./sort";
import { rankSequence } from "./rank";
import { loadOpenRuns, loadTaskRuns } from "./runs";
import { GROUPABLE_TYPES, VIEW_KINDS } from "./types";
import type {
  ActivityDTO,
  ActivityFeedEntryDTO,
  ArchivedTaskDTO,
  BoardData,
  CardView,
  ChecklistItemDTO,
  CommentDTO,
  MemberDTO,
  PropertyDTO,
  PropertyType,
  TaskDTO,
  TaskDetailDTO,
  TaskValue,
  ViewDTO,
  ViewKind,
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
          config: {},
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
        kind: v.kind,
        groupById: v.groupBy ? (byName.get(v.groupBy) ?? null) : null,
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
 *
 * `lens` is the rules the person reading added to this view, and only theirs.
 * It is read the same way and for the same reason: a lens is saved once and
 * read for months, so it outlives the property it names just as a view's rule
 * does. Nothing is passed for an agent, which has no lens.
 */
export function toViewDTO(row: ViewRow, propertyList: PropertyDTO[], lens?: unknown): ViewDTO {
  return {
    id: row.id,
    name: row.name,
    /* A word nobody recognises is a board, which is what every view was
       before this column existed. */
    kind: (VIEW_KINDS as readonly string[]).includes(row.kind) ? (row.kind as ViewKind) : "board",
    groupById: row.groupById,
    position: row.position,
    isDefault: row.isDefault,
    filters: readFilters((row.config as { filters?: unknown } | null)?.filters, propertyList),
    lens: readFilters(lens, propertyList),
    sort: readSort((row.config as { sort?: unknown } | null)?.sort, propertyList),
  };
}

/** The properties of a project with their options, as the board sees them. */
/**
 * The property the board is grouped by when nobody has chosen a view. The
 * default card view leaves it off the card, because the columns already say it.
 *
 * Only a board is asked. A list has no columns to say it, so letting one answer
 * would put a property back on every card in a project that never arranged one
 * — on the day somebody made their main view a list.
 */
export async function defaultGroupById(projectId: string): Promise<string | null> {
  const rows = await db
    .select({ groupById: views.groupById, isDefault: views.isDefault, kind: views.kind })
    .from(views)
    .where(eq(views.projectId, projectId))
    .orderBy(byPos(views.position));
  const boards = rows.filter((v) => v.kind === "board");
  return (boards.find((v) => v.isDefault) ?? boards[0])?.groupById ?? null;
}

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

/**
 * The live tasks of one project, in the rank order every view shares.
 *
 * It asks for the live ones alone, so it walks the partial index and never
 * touches an archived row — and the three count subqueries below, which run
 * once per row, are never run for a task nobody draws.
 */
function liveTaskRows(projectId: string) {
  return (
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
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt)))
      // the number keeps the order stable if two ranks ever match
      .orderBy(byPos(tasks.position), asc(tasks.number))
  );
}

/**
 * The archived tasks, in the few columns a search and a link need. No values
 * and no counts: nothing draws an archived task, and its panel asks for the
 * rest itself.
 */
function archivedTaskRows(projectId: string) {
  return db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      description: tasks.description,
      position: tasks.position,
      archivedAt: tasks.archivedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNotNull(tasks.archivedAt)))
    .orderBy(byPos(tasks.position), asc(tasks.number));
}

/**
 * How many tasks hold a real value for one property, archived ones included.
 *
 * The question the owner answers before deleting a property has to name what
 * the cascade really takes, and the cascade does not care whether a task is on
 * a board. Counting in the browser cannot answer it: the board does not carry
 * the values of an archived task, and one day it will not carry every live
 * task either.
 *
 * It is asked when the delete row is pressed, and never on a board read. Every
 * board load used to pay for a number the owner reads once a month.
 *
 * Empty is what the card and the filter call empty — no row, null, "" or an
 * empty list — so the number reads the same as the board does.
 */
export async function countPropertyValues(propertyId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taskValues)
    .where(
      and(
        eq(taskValues.propertyId, propertyId),
        sql`${taskValues.value} is not null
            and ${taskValues.value} <> 'null'::jsonb
            and ${taskValues.value} <> '""'::jsonb
            and ${taskValues.value} <> '[]'::jsonb`,
      ),
    );
  return row?.count ?? 0;
}

/**
 * The rules one person added to the views of this project, by view id.
 *
 * Only ever this one person's. A lens is not a shared row, so asking for
 * anybody else's — or asking as an agent, which has none — answers nothing.
 */
async function loadLenses(
  projectId: string,
  viewerId: string | null,
): Promise<Map<string, unknown>> {
  if (!viewerId) return new Map();
  const rows = await db
    .select({ viewId: viewLenses.viewId, filters: viewLenses.filters })
    .from(viewLenses)
    .innerJoin(views, eq(views.id, viewLenses.viewId))
    .where(and(eq(viewLenses.userId, viewerId), eq(views.projectId, projectId)));
  return new Map(rows.map((r) => [r.viewId, r.filters]));
}

/**
 * `viewerId` is the person asking, so each view can carry their own lens and
 * nobody else's. An agent passes null: it reads the view's filters, which is
 * what the whole team sees, and a person's own narrowing never reaches it.
 */
export async function loadBoard(
  projectId: string,
  role: string,
  viewerId: string | null = null,
): Promise<BoardData> {
  const [projectRow] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

  const [memberRows, inviteRows, propRows, optRows, viewRows, taskRows, archivedRows, lenses] =
    await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          color: users.color,
          kind: users.kind,
          role: projectMembers.role,
          /* The newest moment any live token of this agent held the stream.
           Two watchers on one agent are one agent listening. */
          listeningAt: sql<
            Date | string | null
          >`(select max(${agentTokens.listeningAt}) from ${agentTokens} where ${agentTokens.agentId} = ${users}.id and ${agentTokens.projectId} = ${projectId} and ${agentTokens.revokedAt} is null)`,
        })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(eq(projectMembers.projectId, projectId))
        .orderBy(asc(users.name)),
      db
        .select({ email: projectInvites.email, createdAt: projectInvites.createdAt })
        .from(projectInvites)
        .where(eq(projectInvites.projectId, projectId))
        .orderBy(asc(projectInvites.createdAt)),
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
      liveTaskRows(projectId),
      archivedTaskRows(projectId),
      loadLenses(projectId, viewerId),
    ]);

  /* Only the live ones. Nothing draws an archived task, so its values are
     fetched when its panel asks for them and not before. */
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

  const viewList: ViewDTO[] = viewRows.map((v) => toViewDTO(v, propertyList, lenses.get(v.id)));

  /* The card a project has before anybody arranges one is the card it drew
     before this page existed, and that card leaves out the columns. So the
     default view says which property those are. */
  const defaultView = viewList.find((v) => v.isDefault) ?? viewList[0] ?? null;
  const cardView: CardView = readCardView(
    projectRow.cardView,
    propertyList,
    defaultView?.groupById ?? null,
  );

  const taskList: TaskDTO[] = taskRows.map((t) => ({
    id: t.id,
    number: t.number,
    key: `${projectRow.key}-${t.number}`,
    title: t.title,
    description: t.description,
    position: t.position,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    /* This list is the live one by construction, so the field is not read
       from the row: a task here is never archived. */
    archivedAt: null,
    values: valuesByTask.get(t.id) ?? {},
    checklistTotal: t.checklistTotal,
    checklistDone: t.checklistDone,
    commentCount: t.commentCount,
  }));

  const archivedList: ArchivedTaskDTO[] = archivedRows.map((t) => ({
    id: t.id,
    number: t.number,
    key: `${projectRow.key}-${t.number}`,
    title: t.title,
    description: t.description,
    position: t.position,
    archivedAt: (t.archivedAt as Date).toISOString(),
  }));

  const members: MemberDTO[] = memberRows.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    color: m.color,
    role: m.role,
    kind: m.kind === "agent" ? "agent" : "human",
    listeningAt: m.listeningAt ? new Date(m.listeningAt).toISOString() : null,
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
    invites: inviteRows.map((i) => ({ email: i.email, createdAt: i.createdAt.toISOString() })),
    properties: propertyList,
    views: viewList,
    cardView,
    tasks: taskList,
    archived: archivedList,
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
      archivedAt: tasks.archivedAt,
      projectKey: projects.key,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!row) return null;

  const [valueRows, checkRows, commentRows, activityRows, runs] = await Promise.all([
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
    loadTaskRuns(taskId),
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
    /* The detail answers for an archived task exactly as it does for a live
       one: the panel opens on a link, and a run that finished keeps its log. */
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    values,
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((c) => c.done).length,
    commentCount: commentList.length,
    checklist,
    comments: commentList,
    activity: activityList,
    run: runs.run,
    pastRuns: runs.pastRuns,
  };
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

// The funnel itself moved to ./activity so that runs.ts can write through it.
// Every route keeps reading it from here.
export { logActivity } from "./activity";

/**
 * A project's activity after a moment, oldest first, for an agent that reads
 * what the stream rang about. The time index makes this one range scan.
 */
export async function loadActivityFeed(
  projectId: string,
  after: Date,
  limit: number,
): Promise<ActivityFeedEntryDTO[]> {
  const rows = await db
    .select({
      id: activity.id,
      kind: activity.kind,
      taskId: activity.taskId,
      taskNumber: tasks.number,
      projectKey: projects.key,
      data: activity.data,
      createdAt: activity.createdAt,
      actorId: users.id,
      actorName: users.name,
      actorKind: users.kind,
    })
    .from(activity)
    .innerJoin(projects, eq(projects.id, activity.projectId))
    .leftJoin(tasks, eq(tasks.id, activity.taskId))
    .leftJoin(users, eq(users.id, activity.actorId))
    .where(and(eq(activity.projectId, projectId), gt(activity.createdAt, after)))
    .orderBy(asc(activity.createdAt), asc(activity.id))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    taskId: r.taskId,
    taskKey: r.taskNumber === null ? null : `${r.projectKey}-${r.taskNumber}`,
    data: (r.data ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
    actor: r.actorId
      ? {
          id: r.actorId,
          name: r.actorName ?? "",
          kind: r.actorKind === "agent" ? "agent" : "human",
        }
      : null,
  }));
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

/**
 * The property a view may take its columns from, checked. Both view routes ask
 * the same question, and a board that groups by a text property has no columns
 * at all, so the answer is a refusal rather than an empty board.
 */
export async function groupPropertyId(projectId: string, propertyId: string): Promise<string> {
  const [prop] = await db
    .select({ id: properties.id, type: properties.type, projectId: properties.projectId })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  if (!prop || prop.projectId !== projectId)
    throw new HttpError(400, "That property is not in this project.");
  if (!GROUPABLE_TYPES.includes(prop.type as PropertyType)) {
    throw new HttpError(400, "A view can only group by a select, person or checkbox property.");
  }
  return prop.id;
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
