import { eq } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route, str } from "@/lib/api";
import { groupPropertyId, toViewDTO, withProjectLock } from "@/lib/queries";
import { rankAfter } from "@/lib/rank";
import { VIEW_KINDS, type ViewKind } from "@/lib/types";

type Ctx = { params: Promise<{ projectId: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  await guard(projectId);

  const input = await body<{ name?: string; kind?: string; groupById?: string | null }>(req);
  const name = str(input.name, "View name", { max: 40 });

  // A request that says nothing about the kind means a board, which is what
  // every view was before there was more than one.
  const wanted = input.kind ?? "board";
  if (!(VIEW_KINDS as readonly string[]).includes(wanted))
    throw new HttpError(400, "A view is a board or a list.");
  const kind = wanted as ViewKind;

  // A board is its columns, so it cannot be made without one. A list groups
  // nothing, and asks for nothing.
  let groupById: string | null = null;
  if (kind === "board") {
    if (typeof input.groupById !== "string")
      throw new HttpError(400, "Choose a property to group by.");
    groupById = await groupPropertyId(projectId, input.groupById);
  } else if (typeof input.groupById === "string" && input.groupById) {
    groupById = await groupPropertyId(projectId, input.groupById);
  }

  const view = await withProjectLock(projectId, async (tx) => {
    const siblings = await tx
      .select({ position: views.position })
      .from(views)
      .where(eq(views.projectId, projectId))
      .orderBy(byPos(views.position));

    const [row] = await tx
      .insert(views)
      .values({
        projectId,
        name,
        kind,
        groupById,
        position: rankAfter(siblings.at(-1)?.position ?? null),
        isDefault: siblings.length === 0,
        config: {},
      })
      .returning();
    return row;
  });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  // A new view has no filters, so the property list it is read against can be
  // empty: `readFilters` has nothing to check.
  return json({ view: toViewDTO(view, []) }, 201);
});
