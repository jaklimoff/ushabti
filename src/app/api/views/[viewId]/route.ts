import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import {
  body,
  broadcast,
  clientIdOf,
  guard,
  humanOnly,
  json,
  ownerOnly,
  route,
  str,
} from "@/lib/api";
import { readFilters } from "@/lib/filters";
import { byPos } from "@/lib/order";
import { groupPropertyId, loadProperties, viewProjectId, withProjectLock } from "@/lib/queries";
import { rankBetween } from "@/lib/rank";
import { readSort } from "@/lib/sort";
import { VIEW_KINDS } from "@/lib/types";

type Ctx = { params: Promise<{ viewId: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { viewId } = await ctx.params;
  const projectId = await viewProjectId(viewId);
  if (!projectId) throw new HttpError(404, "View not found.");
  const { user } = await guard(projectId);

  const input = await body<{
    name?: string;
    kind?: string;
    groupById?: string | null;
    filters?: unknown;
    sort?: unknown;
    afterId?: string | null;
  }>(req);
  const patch: Record<string, unknown> = {};

  const [current] = await db.select().from(views).where(eq(views.id, viewId)).limit(1);
  if (!current) throw new HttpError(404, "View not found.");

  if (input.name !== undefined) patch.name = str(input.name, "View name", { max: 40 });

  if (input.kind !== undefined) {
    if (!(VIEW_KINDS as readonly string[]).includes(input.kind))
      throw new HttpError(400, "A view is a board or a list.");
    patch.kind = input.kind;
  }

  if (input.groupById !== undefined) {
    patch.groupById =
      input.groupById === null || input.groupById === ""
        ? null
        : await groupPropertyId(projectId, input.groupById);
  }

  /* A board is its columns. Turning a list into one without a property to make
     them from would leave a screen with nothing on it. */
  const kind = "kind" in patch ? (patch.kind as string) : current.kind;
  /* `??` cannot be used here: a list clearing its grouping writes null on
     purpose, and null is exactly what `??` reads as "nothing was said". */
  const groupById = "groupById" in patch ? (patch.groupById as string | null) : current.groupById;
  if (kind === "board" && !groupById)
    throw new HttpError(400, "A board needs a property to make its columns from.");

  if (input.filters !== undefined || input.sort !== undefined) {
    const properties = await loadProperties(projectId);
    let config = { ...((current.config ?? {}) as object) };

    if (input.filters !== undefined) {
      // A filter says what everybody on this board can see. An agent writes
      // values all day; it does not get to hide the work from the people.
      humanOnly(user);
      // The same reading the board does. A rule this cannot make sense of is
      // dropped here rather than saved and ignored for ever afterwards.
      config = { ...config, filters: readFilters(input.filters, properties) };
    }

    if (input.sort !== undefined) {
      /* No `humanOnly` here, and on purpose. A filter is guarded because it
         hides work from the people; a sort hides nothing and shows every task
         either way, so it sits with the grouping property rather than with the
         filters. The same reading the list does, so a column that is gone
         cannot be saved as an order. */
      config = { ...config, sort: readSort(input.sort, properties) };
    }

    patch.config = config;
  }

  /* A drag says which view this one landed after, never a rank: the rank is
     worked out here under the project lock, exactly as a property's is. Null
     means the front of the strip. */
  if (input.afterId !== undefined) {
    await withProjectLock(projectId, async (tx) => {
      const siblings = await tx
        .select({ id: views.id, position: views.position })
        .from(views)
        .where(and(eq(views.projectId, projectId), ne(views.id, viewId)))
        .orderBy(byPos(views.position));
      const index = input.afterId ? siblings.findIndex((s) => s.id === input.afterId) : -1;
      const before = index >= 0 ? siblings[index].position : null;
      const after = siblings[index + 1]?.position ?? null;
      await tx
        .update(views)
        .set({ ...patch, position: rankBetween(before, after) })
        .where(eq(views.id, viewId));
    });
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
    return json({ ok: true });
  }

  if (Object.keys(patch).length === 0) return json({ ok: true });
  await db.update(views).set(patch).where(eq(views.id, viewId));
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { viewId } = await ctx.params;
  const projectId = await viewProjectId(viewId);
  if (!projectId) throw new HttpError(404, "View not found.");
  const { user, membership } = await guard(projectId);
  ownerOnly(user, membership, "delete a view");

  const [view] = await db.select().from(views).where(eq(views.id, viewId)).limit(1);
  if (view.isDefault) throw new HttpError(400, "The main view cannot be deleted.");

  await db.delete(views).where(eq(views.id, viewId));
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});
