import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lists } from "@/db/schema";
import { body, json, route, str } from "@/lib/api";
import { listGroups } from "@/lib/lists";
import { boardsFor, boardsOnce, ownList, sourcesOf } from "@/lib/lists-load";
import { listProjects } from "@/lib/queries";

type Ctx = { params: Promise<{ listId: string }> };

/** The list and its tasks, grouped by project, read afresh. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { user, list } = await ownList((await ctx.params).listId);
  const sources = await sourcesOf([list.id]);
  const projects = await listProjects(user.id);
  const boards = await boardsFor(sources, projects, boardsOnce(user.id));
  return json({
    list: { id: list.id, name: list.name },
    sources: sources.map((s) => ({ id: s.id, projectId: s.projectId })),
    groups: listGroups(sources, boards, user.id),
  });
});

/** The name. Nothing else about a list is a field. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { list } = await ownList((await ctx.params).listId);
  const input = await body<{ name?: unknown }>(req);
  const name = str(input.name, "Name", { max: 80 });
  await db.update(lists).set({ name }).where(eq(lists.id, list.id));
  return json({ list: { id: list.id, name } });
});

/** The list and its sources go. The tasks are the projects', and stay. */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const { list } = await ownList((await ctx.params).listId);
  await db.delete(lists).where(eq(lists.id, list.id));
  return json({ ok: true });
});
