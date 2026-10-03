import { eq } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, route, str } from "@/lib/api";
import { startsOnCurrent } from "@/lib/filters";
import {
  groupPropertyId,
  loadProperties,
  projectToday,
  toViewDTO,
  withProjectLock,
} from "@/lib/queries";
import { rankAfter } from "@/lib/rank";
import { GROUPED_KINDS, VIEW_KINDS, type ViewKind } from "@/lib/types";

type Ctx = { params: Promise<{ projectId: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user } = await guard(projectId);

  const input = await body<{ name?: string; kind?: string; groupById?: string | null }>(req);
  const name = str(input.name, "View name", { max: 40 });

  // A request that says nothing about the kind means a board, which is what
  // every view was before there was more than one.
  const wanted = input.kind ?? "board";
  if (!(VIEW_KINDS as readonly string[]).includes(wanted))
    throw new HttpError(400, "A view is a board, a list or a roadmap.");
  const kind = wanted as ViewKind;

  // A board is its columns and a roadmap its rows, so neither can be made
  // without a property. A list groups nothing, and asks for nothing.
  let groupById: string | null = null;
  if (GROUPED_KINDS.includes(kind)) {
    if (typeof input.groupById !== "string")
      throw new HttpError(400, "Choose a property to group by.");
    groupById = await groupPropertyId(projectId, input.groupById, kind);
  } else if (typeof input.groupById === "string" && input.groupById) {
    groupById = await groupPropertyId(projectId, input.groupById);
  }

  /* A new board grouped by an iteration starts on the sprint that is on now,
     as a board grouped by one later does. An agent writes no filters. */
  const properties = await loadProperties(projectId);
  const group = properties.find((p) => p.id === groupById);
  const filters =
    kind === "board" && group && user.kind === "human"
      ? startsOnCurrent({ rules: [] }, group, await projectToday(projectId))
      : null;

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
        config: filters && filters.rules.length ? { filters } : {},
      })
      .returning();
    return row;
  });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ view: toViewDTO(view, properties) }, 201);
});
