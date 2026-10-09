import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { listSources, lists } from "@/db/schema";
import { readId } from "./api";
import { HttpError, requireActor } from "./auth";
import { listGroups, sourceRules, summaryOf, type ListSummary, type StoredSource } from "./lists";
import { isId } from "./ids";
import { byPos } from "./order";
import { listProjects, loadBoard } from "./queries";
import type { BoardData, ViewFilters } from "./types";

/**
 * The server half of a list: whose it is, and the boards its sources read.
 * The reading itself is `lists.ts`, which never touches the database.
 */

export type ProjectRow = Awaited<ReturnType<typeof listProjects>>[number];

/** One board per project, asked once however many readers want it. */
export type BoardOf = (row: Pick<ProjectRow, "id" | "role">) => Promise<BoardData>;

export function boardsOnce(userId: string): BoardOf {
  const asked = new Map<string, Promise<BoardData>>();
  return (row) => {
    let board = asked.get(row.id);
    if (!board) {
      board = loadBoard(row.id, row.role, userId);
      asked.set(row.id, board);
    }
    return board;
  };
}

/**
 * The person's own list, or a 404. A list another person owns answers the
 * same as one that does not exist, so an id never tells anybody it is there.
 * An agent is refused first: it has no lists, as it has no lens.
 */
export async function ownList(listId: string) {
  const user = await requireActor();
  if (user.kind !== "human") throw new HttpError(403, "Only a person can do this.");
  readId(listId, "list");
  const [list] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, user.id)))
    .limit(1);
  if (!list) throw new HttpError(404, "List not found.");
  return { user, list };
}

export async function listsOf(userId: string) {
  return db
    .select({ id: lists.id, name: lists.name, position: lists.position })
    .from(lists)
    .where(eq(lists.userId, userId))
    .orderBy(byPos(lists.position), asc(lists.createdAt));
}

export async function sourcesOf(
  listIds: string[],
): Promise<(StoredSource & { listId: string; position: string })[]> {
  if (listIds.length === 0) return [];
  return db
    .select({
      id: listSources.id,
      listId: listSources.listId,
      projectId: listSources.projectId,
      filters: listSources.filters,
      position: listSources.position,
    })
    .from(listSources)
    .where(inArray(listSources.listId, listIds))
    .orderBy(byPos(listSources.position));
}

/**
 * The boards of the projects these sources name that the person is still a
 * member of, in their project order. A source of a project they left finds
 * no board here, so it brings nothing; nothing deletes it.
 */
export async function boardsFor(
  sources: StoredSource[],
  projects: ProjectRow[],
  boardOf: BoardOf,
): Promise<BoardData[]> {
  const named = new Set(sources.map((s) => s.projectId));
  return Promise.all(projects.filter((p) => named.has(p.id)).map(boardOf));
}

/** Every list of the person, as the cards on Home read them. */
export async function listSummaries(
  userId: string,
  projects: ProjectRow[],
  boardOf: BoardOf = boardsOnce(userId),
): Promise<ListSummary[]> {
  const rows = await listsOf(userId);
  const sources = await sourcesOf(rows.map((l) => l.id));
  const boards = await boardsFor(sources, projects, boardOf);
  return rows.map((list) =>
    summaryOf(
      list,
      listGroups(
        sources.filter((s) => s.listId === list.id),
        boards,
        userId,
      ),
    ),
  );
}

/** For a page: the person's own list, or null for anything else. */
export async function findList(listId: string, userId: string) {
  if (!isId(listId)) return null;
  const [list] = await db
    .select({ id: lists.id, name: lists.name })
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .limit(1);
  return list ?? null;
}

/** What the edit page needs to draw one source: its project and its chips. */
export type SourceShape = {
  id: string;
  projectId: string;
  key: string;
  name: string;
  properties: BoardData["properties"];
  members: BoardData["members"];
  former: BoardData["former"];
  rules: ViewFilters["rules"];
};

export async function sourceShape(
  source: StoredSource,
  row: Pick<ProjectRow, "id" | "role">,
  boardOf: BoardOf,
): Promise<SourceShape> {
  const board = await boardOf(row);
  return {
    id: source.id,
    projectId: source.projectId,
    key: board.project.key,
    name: board.project.name,
    properties: board.properties,
    members: board.members,
    former: board.former,
    rules: sourceRules(source.filters, board).rules,
  };
}
