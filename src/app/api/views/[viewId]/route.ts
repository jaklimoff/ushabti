import { eq } from "drizzle-orm";
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
import { groupPropertyId, loadProperties, viewProjectId } from "@/lib/queries";
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

  if (input.filters !== undefined) {
    // A filter says what everybody on this board can see. An agent writes
    // values all day; it does not get to hide the work from the people.
    humanOnly(user);
    // The same reading the board does. A rule this cannot make sense of is
    // dropped here rather than saved and ignored for ever afterwards.
    const filters = readFilters(input.filters, await loadProperties(projectId));
    patch.config = { ...((current.config ?? {}) as object), filters };
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
