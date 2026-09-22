import "server-only";
import { byPos } from "@/lib/order";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
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
  taskLinks,
  taskValues,
  tasks,
  users,
  viewLenses,
  views,
} from "@/db/schema";
import { readId } from "./api";
import { HttpError } from "./auth";
import { readCardView } from "./card-view";
import { goesAt, sweepCutoff } from "./deleted";
import { DEFAULT_PROPERTIES, DEFAULT_VIEWS } from "./defaults";
import { readFilters } from "./filters";
import { readTimeZone, todayIn } from "./day";
import { isOver, readDoneWhen, type DoneWhen, type LinkEdge } from "./links";
import { readSort } from "./sort";
import { rankAfter, rankSequence, rebalanceTail, type Rebalance } from "./rank";
import { loadOpenRuns, loadTaskRuns } from "./runs";
import { kickSender } from "./webhooks";
import { GROUPABLE_TYPES, VIEW_KINDS } from "./types";
import type {
  ActivityDTO,
  ActivityFeedEntryDTO,
  ArchivedTaskDTO,
  BoardData,
  CardView,
  ChecklistItemDTO,
  CommentDTO,
  DeletedTaskDTO,
  MemberDTO,
  PropertyDTO,
  PropertyType,
  TaskDTO,
  TaskDetailDTO,
  TaskLinkDTO,
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

/**
 * Put the end of a task list back where there is room, and answer with the
 * rank for the task going on it.
 *
 * `ordered` is every task in the project, in order, which both callers already
 * hold under the lock. When the end has run out of room the rewritten rows go
 * in one statement, because the point of the rewrite is that it costs one
 * write however many rows it touches. It leaves `updated_at` alone: nothing
 * moved, and a rank is not something a person said.
 *
 * `rewrote` says a rewrite happened. The tab that asked holds the old ranks of
 * the rows it did not ask about, so it has to be told to read the board again
 * with everybody else.
 */
export async function rankOnTheEnd(
  tx: Tx,
  ordered: { id: string; position: string }[],
): Promise<{ position: string; rewrote: boolean }> {
  const plan: Rebalance | null = rebalanceTail(ordered.map((t) => t.position));
  if (!plan) return { position: rankAfter(ordered.at(-1)?.position ?? null), rewrote: false };

  /* The rows travel as one parameter and not two per row: a list long enough
     to mend a whole board would pass what one statement may carry. */
  const rows = ordered.slice(plan.from).map((row, i) => ({ id: row.id, position: plan.ranks[i] }));
  await tx.execute(sql`
    update ${tasks} set position = fresh.position
    from json_to_recordset(${JSON.stringify(rows)}::json) as fresh(id uuid, position text)
    where ${tasks.id} = fresh.id
  `);
  return { position: plan.next, rewrote: true };
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
export async function defaultGroupById(projectId: string, tx?: Tx): Promise<string | null> {
  const rows = await (tx ?? db)
    .select({ groupById: views.groupById, isDefault: views.isDefault, kind: views.kind })
    .from(views)
    .where(eq(views.projectId, projectId))
    .orderBy(byPos(views.position));
  const boards = rows.filter((v) => v.kind === "board");
  return (boards.find((v) => v.isDefault) ?? boards[0])?.groupById ?? null;
}

/**
 * The properties of a project, with their options.
 *
 * It takes a transaction for the one caller that has to read the board inside
 * the lock it is about to write under: an import reads the options it may land
 * on and then adds the ones it must, and a read from outside that transaction
 * could answer from before the import that went first.
 */
export async function loadProperties(projectId: string, tx?: Tx): Promise<PropertyDTO[]> {
  const handle = tx ?? db;
  const [propRows, optRows] = await Promise.all([
    handle
      .select()
      .from(properties)
      .where(eq(properties.projectId, projectId))
      .orderBy(byPos(properties.position)),
    handle
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
 * touches an archived or a deleted row — and the three count subqueries
 * below, which run once per row, are never run for a task nobody draws.
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
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt), isNull(tasks.deletedAt)))
      // the number keeps the order stable if two ranks ever match
      .orderBy(byPos(tasks.position), asc(tasks.number))
  );
}

/**
 * The archived tasks, in the few columns a search and a link need. No values
 * and no counts: nothing draws an archived task, and its panel asks for the
 * rest itself.
 *
 * A task deleted while it was archived is not here. It is deleted, and a
 * deleted task never reaches the browser; the drawer lists it, and putting it
 * back makes it archived again.
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
    .where(
      and(eq(tasks.projectId, projectId), isNotNull(tasks.archivedAt), isNull(tasks.deletedAt)),
    )
    .orderBy(byPos(tasks.position), asc(tasks.number));
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

/**
 * Every blocked-by link of one project, as the pairs of ids they are.
 *
 * Both ends of a link are always in one project — the write refuses anything
 * else — so joining on one end names the whole set. The circle check walks
 * these, under the project lock, in the transaction that writes the new one.
 */
export async function projectLinks(projectId: string, tx: Tx): Promise<LinkEdge[]> {
  return tx
    .select({ fromId: taskLinks.fromId, toId: taskLinks.toId })
    .from(taskLinks)
    .innerJoin(tasks, eq(tasks.id, taskLinks.toId))
    .where(eq(tasks.projectId, projectId));
}

/** A task as a link route needs it: the key it wears and the board it is on. */
export type TaskCard = { id: string; key: string; projectId: string; gone: boolean };

/**
 * A few tasks by id, with the key a person says out loud.
 *
 * The key is built from the project prefix and never stored, so naming a task
 * in a sentence — the circle refusal, the feed line — means reading both. The
 * transaction is passed in when the answer has to be the one the lock is
 * holding.
 */
export async function taskCards(ids: string[], tx?: Tx): Promise<Map<string, TaskCard>> {
  if (ids.length === 0) return new Map();
  const rows = await (tx ?? db)
    .select({
      id: tasks.id,
      number: tasks.number,
      projectId: tasks.projectId,
      deletedAt: tasks.deletedAt,
      projectKey: projects.key,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(inArray(tasks.id, ids));

  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        key: `${r.projectKey}-${r.number}`,
        projectId: r.projectId,
        gone: r.deletedAt !== null,
      },
    ]),
  );
}

/**
 * The tasks at the other end of one task's links, one direction at a time.
 *
 * An archived task is here: over is what archived usually means, and a link
 * nobody can see is a link nobody can remove. A deleted one is not, because a
 * deleted task is off every board, list, search and count.
 */
async function linkedTasks(taskId: string, way: "blockedBy" | "blocks") {
  const mine = way === "blockedBy" ? taskLinks.toId : taskLinks.fromId;
  const other = way === "blockedBy" ? taskLinks.fromId : taskLinks.toId;
  return db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      archivedAt: tasks.archivedAt,
    })
    .from(taskLinks)
    .innerJoin(tasks, eq(tasks.id, other))
    .where(and(eq(mine, taskId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.number));
}

/** What these tasks hold for the one property the project calls done. */
async function doneValues(
  ids: string[],
  doneWhen: DoneWhen | null,
): Promise<Map<string, TaskValue>> {
  if (!doneWhen || ids.length === 0) return new Map();
  const rows = await db
    .select({ taskId: taskValues.taskId, value: taskValues.value })
    .from(taskValues)
    .where(and(inArray(taskValues.taskId, ids), eq(taskValues.propertyId, doneWhen.propertyId)));
  return new Map(rows.map((r) => [r.taskId, r.value as TaskValue]));
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
 *
 * A deleted task is not counted. Its values will go with it when the sweep
 * takes it, so naming them in the question would price a cost the owner
 * cannot see and did not ask about.
 */
export async function countPropertyValues(propertyId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taskValues)
    .innerJoin(tasks, eq(tasks.id, taskValues.taskId))
    .where(
      and(
        eq(taskValues.propertyId, propertyId),
        isNull(tasks.deletedAt),
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
  /* The sender runs on the read path as the lease does, and for the same
     reason: a board is read far more often than any schedule would fire, and
     a retry a minute old should go out without a job this project would then
     have to run, watch and ship. It is started, never awaited. */
  kickSender();

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
  const [valueRows, runs, linkRows] = await Promise.all([
    taskIds.length
      ? db.select().from(taskValues).where(inArray(taskValues.taskId, taskIds))
      : Promise.resolve([]),
    loadOpenRuns(projectId),
    /* Only what the cards on this board wait on. What they block is the
       panel's half of the chain, and the panel asks for it itself. */
    taskIds.length
      ? db
          .select({ fromId: taskLinks.fromId, toId: taskLinks.toId })
          .from(taskLinks)
          .where(inArray(taskLinks.toId, taskIds))
      : Promise.resolve([]),
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

  /*
   * What each card waits on, as the keys of the blockers that are not over.
   *
   * Over is read afresh here, exactly as a filter is: archived always counts,
   * and the project may name one option of one property beside it. A link to
   * a task that was deleted is not counted at all — a deleted task is off
   * every board, list and count, and a chain glyph is a count.
   */
  const doneWhen = readDoneWhen(projectRow.doneWhen, propertyList);
  /* The zone is read afresh, exactly as the filters above are: a name this
     runtime no longer knows answers UTC rather than throwing the board away. */
  const timeZone = readTimeZone(projectRow.timeZone);
  const blockers = new Map<string, { number: number; over: boolean }>();
  for (const t of taskRows) {
    blockers.set(t.id, {
      number: t.number,
      over: isOver({ archivedAt: null, values: valuesByTask.get(t.id) ?? {} }, doneWhen),
    });
  }
  for (const t of archivedRows) blockers.set(t.id, { number: t.number, over: true });

  const waitsOn = new Map<string, number[]>();
  for (const link of linkRows) {
    const blocker = blockers.get(link.fromId);
    if (!blocker || blocker.over) continue;
    const list = waitsOn.get(link.toId);
    if (list) list.push(blocker.number);
    else waitsOn.set(link.toId, [blocker.number]);
  }
  /* The glyph's tooltip names them, so the order has to be the same on every
     read. The number is the one order a key has. */
  for (const list of waitsOn.values()) list.sort((a, b) => a - b);

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
    blockedBy: (waitsOn.get(t.id) ?? []).map((n) => `${projectRow.key}-${n}`),
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
      doneWhen,
      timeZone,
    },
    /* The one clock this board reads. Every relative date rule on every view
       is measured against it, on the server now and in the browser after it
       hydrates, so both renders draw the same cards. */
    today: todayIn(timeZone),
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
      projectId: tasks.projectId,
      projectKey: projects.key,
      doneWhen: projects.doneWhen,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!row) return null;

  const [valueRows, checkRows, commentRows, activityRows, runs, waits, holds] = await Promise.all([
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
    linkedTasks(taskId, "blockedBy"),
    linkedTasks(taskId, "blocks"),
  ]);

  /* Over is the project's word, read afresh: a property or an option that is
     gone falls back to archived. One read answers for both lists. */
  const doneWhen = readDoneWhen(row.doneWhen, await loadProperties(row.projectId));
  const heldValues = await doneValues(
    [...waits, ...holds].map((t) => t.id),
    doneWhen,
  );
  const asLink = (t: (typeof waits)[number]): TaskLinkDTO => ({
    id: t.id,
    key: `${row.projectKey}-${t.number}`,
    title: t.title,
    over: isOver(
      {
        archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
        values: doneWhen ? { [doneWhen.propertyId]: heldValues.get(t.id) ?? null } : {},
      },
      doneWhen,
    ),
  });
  const links = { blockedBy: waits.map(asLink), blocks: holds.map(asLink) };

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
    blockedBy: links.blockedBy.filter((t) => !t.over).map((t) => t.key),
    links,
    checklist,
    comments: commentList,
    activity: activityList,
    run: runs.run,
    pastRuns: runs.pastRuns,
  };
}

/* ------------------------------------------------------------------ */
/* The drawer: what was deleted, and what has run out                  */
/* ------------------------------------------------------------------ */

/**
 * Takes away every deleted task of one project whose window is over.
 *
 * It runs on the write and on the read of the drawer, as the reset links are
 * swept by the write that makes one and as the lease closes a lost run on the
 * read path. There is no timer in Ushabti and this must not be the reason for
 * the first one.
 *
 * The price is named rather than hidden: a project that deletes one task and
 * then never deletes another, and never opens the drawer, keeps that row past
 * its thirty days. Nobody can see it — every read hides it — and the next
 * delete or the next look in the drawer takes it.
 *
 * This is the hard delete, and it is the one the route used to do: the
 * cascades on `tasks` take the values, the checklist, the comments, the runs
 * and the activity with it.
 */
export async function sweepDeleted(projectId: string, now = new Date()): Promise<number> {
  const gone = await db
    .delete(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNotNull(tasks.deletedAt),
        lt(tasks.deletedAt, sweepCutoff(now.getTime())),
      ),
    )
    .returning({ id: tasks.id });
  return gone.length;
}

/**
 * What is in the drawer of one project, newest deleted first.
 *
 * It sweeps first, so the page never lists a row that is already past its
 * window and a put back can never answer for one.
 *
 * The rows are carried light, as the archived ones are: no values, no counts
 * and no description. A deleted task is not drawn anywhere — the row says
 * what it was and how long is left, and the way back is the only thing you
 * can do with it.
 */
export async function loadDeletedTasks(
  projectId: string,
  now = new Date(),
): Promise<DeletedTaskDTO[]> {
  await sweepDeleted(projectId, now);

  const rows = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      position: tasks.position,
      deletedAt: tasks.deletedAt,
      projectKey: projects.key,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.projectId, projectId), isNotNull(tasks.deletedAt)))
    .orderBy(desc(tasks.deletedAt), asc(tasks.number));

  return rows.map((row) => {
    const at = (row.deletedAt as Date).toISOString();
    return {
      id: row.id,
      number: row.number,
      key: `${row.projectKey}-${row.number}`,
      title: row.title,
      position: row.position,
      deletedAt: at,
      goesAt: goesAt(at),
    };
  });
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

/**
 * The project one task is in, or null when there is no such task to see.
 *
 * Every task route starts here, so this is the one place a deleted task turns
 * into a `404`. That is what delete means to whoever holds the id: the task is
 * gone, its values, its checklist, its comments and its runs answer nothing,
 * and no route has to remember the rule for itself.
 *
 * Put back is the one exception, and it asks below.
 */
export async function taskProjectId(taskId: string): Promise<string | null> {
  readId(taskId, "task");
  const [row] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  return row?.projectId ?? null;
}

/**
 * The same question for the one route that has to see a deleted task.
 *
 * Put back is the way out of the drawer, so it must find what every other
 * route hides. It answers for a live task too, which is what makes a second
 * put back free: the update names the state it changes from and writes
 * nothing, exactly as a second archive does.
 */
export async function taskProjectIdEvenDeleted(taskId: string): Promise<string | null> {
  readId(taskId, "task");
  const [row] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.projectId ?? null;
}

export async function propertyProjectId(propertyId: string): Promise<string | null> {
  readId(propertyId, "property");
  const [row] = await db
    .select({ projectId: properties.projectId })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return row?.projectId ?? null;
}

export async function optionPropertyId(optionId: string) {
  readId(optionId, "option");
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
  readId(propertyId, "property");
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
  readId(viewId, "view");
  const [row] = await db
    .select({ projectId: views.projectId })
    .from(views)
    .where(eq(views.id, viewId))
    .limit(1);
  return row?.projectId ?? null;
}

export async function checklistTaskId(itemId: string): Promise<string | null> {
  readId(itemId, "checklist item");
  const [row] = await db
    .select({ taskId: checklistItems.taskId })
    .from(checklistItems)
    .where(eq(checklistItems.id, itemId))
    .limit(1);
  return row?.taskId ?? null;
}

export async function commentRow(commentId: string) {
  readId(commentId, "comment");
  const [row] = await db
    .select({ id: comments.id, taskId: comments.taskId, authorId: comments.authorId })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  return row ?? null;
}

export { and, eq };
