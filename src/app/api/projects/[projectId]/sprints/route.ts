import { eq } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { projects, properties, propertyOptions, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { adminOnly, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { CADENCE_DEFAULT, firstSprints, readCadenceInput } from "@/lib/cadence";
import { nextPaletteColor } from "@/lib/colors";
import { todayIn } from "@/lib/day";
import { isoDay } from "@/lib/option-dates";
import { defaultGroupById, withProjectLock } from "@/lib/queries";
import { rankAfter } from "@/lib/rank";
import { SPRINT, sprintsSetUp, sprintViews } from "@/lib/sprints";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Sets up sprints: the Sprint property, the Sprint board and the Backlog list.
 * The body may carry `length`, a sprint's days, and `startAt`, the first
 * sprint's first day; they default to 14 and the project's today. It makes
 * the first sprint and the one after it, so the board has a current sprint
 * and a next one to plan into. Ship makes each one after that.
 *
 * One transaction under the project lock, so a board never holds the property
 * without its views, and two presses at once cannot make two of each. The
 * second one reads the Sprint the first one wrote and is refused. It is
 * structure, so it is an admin's, and a person's.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  adminOnly(user, membership, "set up sprints");
  const { length, startAt } = await readSetUp(req);

  await withProjectLock(projectId, async (tx) => {
    const props = await tx
      .select({ name: properties.name, position: properties.position })
      .from(properties)
      .where(eq(properties.projectId, projectId))
      .orderBy(byPos(properties.position));
    if (sprintsSetUp(props)) throw new HttpError(409, "Sprints are set up.");
    const cadence = { length };
    let first = startAt;
    if (!first) {
      const [project] = await tx
        .select({ timeZone: projects.timeZone })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      first = todayIn(project.timeZone);
    }

    const [sprint] = await tx
      .insert(properties)
      .values({
        projectId,
        name: SPRINT,
        // An iteration always carries dates, so its boxes are there from the start.
        type: "iteration",
        position: rankAfter(props.at(-1)?.position ?? null),
        config: { cadence },
      })
      .returning({ id: properties.id });

    let rank: string | null = null;
    const colors: string[] = [];
    for (const made of firstSprints(first, cadence.length)) {
      rank = rankAfter(rank);
      const color = nextPaletteColor(colors);
      colors.push(color);
      await tx.insert(propertyOptions).values({
        propertyId: sprint.id,
        ...made,
        color,
        position: rank,
      });
    }

    const siblings = await tx
      .select({ position: views.position })
      .from(views)
      .where(eq(views.projectId, projectId))
      .orderBy(byPos(views.position));
    let position = siblings.at(-1)?.position ?? null;
    const groupById = await defaultGroupById(projectId, tx);

    for (const [at, view] of sprintViews(sprint.id, groupById).entries()) {
      position = rankAfter(position);
      await tx.insert(views).values({
        projectId,
        name: view.name,
        kind: view.kind,
        groupById: view.groupById,
        position,
        // A project with no view would have no main one, so the board takes it.
        isDefault: siblings.length === 0 && at === 0,
        config: { filters: view.filters },
      });
    }
  });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true }, 201);
});

/** The body, which may be empty: a press with no answers takes the defaults. */
async function readSetUp(req: Request): Promise<{ length: number; startAt: string | null }> {
  const text = await req.text();
  let input: { length?: unknown; startAt?: unknown } = {};
  if (text.trim()) {
    try {
      input = JSON.parse(text) as typeof input;
    } catch {
      throw new HttpError(400, "The request body must be JSON.");
    }
    if (!input || typeof input !== "object") {
      throw new HttpError(400, "The request body must be an object.");
    }
  }
  const read = readCadenceInput({ length: input.length });
  if ("error" in read) throw new HttpError(400, read.error);
  let startAt: string | null = null;
  if (input.startAt !== undefined && input.startAt !== null && input.startAt !== "") {
    startAt = typeof input.startAt === "string" ? isoDay(input.startAt) : null;
    if (!startAt) throw new HttpError(400, "The first day must be a date like 2026-10-03.");
  }
  return { length: read.patch.length ?? CADENCE_DEFAULT.length, startAt };
}
