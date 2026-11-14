import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects, propertyOptions, properties } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, humanOnly, json, route } from "@/lib/api";
import { readCardView } from "@/lib/card-view";
import { copiedCardView, copiedLooks, countLook, matchLook } from "@/lib/look";
import { byPos } from "@/lib/order";
import { defaultGroupById, loadProperties, withProjectLock } from "@/lib/queries";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Every other project of the caller, in their Home order, with what copying
 * its look into this one would touch. One request answers the whole list, so
 * the lines of the question arrive together.
 *
 * A person does this, as on the card view route. A project the caller is not
 * a member of is never listed, so nothing here names one.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);
  humanOnly(user);

  const others = await db
    .select({ id: projects.id, key: projects.key, name: projects.name, color: projects.color })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.userId, user.id), ne(projects.id, projectId)))
    .orderBy(byPos(projectMembers.position), desc(projectMembers.createdAt));

  const [here, ...there] = await Promise.all([
    loadProperties(projectId),
    ...others.map((p) => loadProperties(p.id)),
  ]);

  return json({
    projects: others.map((p, i) => ({ ...p, count: countLook(matchLook(here, there[i])) })),
  });
});

/**
 * This project takes another's look: its default card, and the icon and
 * colour of each option and checkbox, by the halves the body names. Nothing
 * is made, deleted, renamed or moved, no view's own card changes and no task
 * changes. Any member may do it, because a member can make each of these
 * changes by hand. The whole write is one transaction under this project's
 * lock; the other project is only read.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);
  humanOnly(user);

  const input = await body<{ from?: unknown; layout?: unknown; looks?: unknown }>(req);
  const layout = input.layout === true;
  const looks = input.looks === true;
  if (!layout && !looks) throw new HttpError(400, "Pick what to copy.");
  if (typeof input.from !== "string") throw new HttpError(400, "Pick a project to copy from.");
  if (input.from === projectId) throw new HttpError(400, "A project cannot copy itself.");
  /* As any project route refuses it, so the answer says nothing about it. */
  const from = input.from;
  await guard(from);

  const cardView = await withProjectLock(projectId, async (tx) => {
    const [here, there, groupHere, groupThere, rows] = await Promise.all([
      loadProperties(projectId, tx),
      loadProperties(from, tx),
      defaultGroupById(projectId, tx),
      defaultGroupById(from, tx),
      tx
        .select({ id: projects.id, cardView: projects.cardView })
        .from(projects)
        .where(inArray(projects.id, [projectId, from])),
    ]);
    const savedOf = (id: string) => rows.find((r) => r.id === id)?.cardView ?? null;
    const match = matchLook(here, there);

    let written = null;
    if (layout) {
      const mine = readCardView(savedOf(projectId), here, groupHere);
      const theirs = readCardView(savedOf(from), there, groupThere);
      written = readCardView(copiedCardView(mine, theirs, match), here, groupHere);
      await tx.update(projects).set({ cardView: written }).where(eq(projects.id, projectId));
    }

    if (looks) {
      const writes = copiedLooks(match);
      for (const o of writes.options) {
        await tx
          .update(propertyOptions)
          .set({ color: o.color, icon: o.icon })
          .where(eq(propertyOptions.id, o.id));
      }
      for (const c of writes.checkboxes) {
        const patch = JSON.stringify({ icon: c.icon, color: c.color });
        await tx
          .update(properties)
          .set({ config: sql`${properties.config} || ${patch}::jsonb` })
          .where(and(eq(properties.id, c.id), eq(properties.projectId, projectId)));
      }
    }
    return written;
  });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ cardView });
});
