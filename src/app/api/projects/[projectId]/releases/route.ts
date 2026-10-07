import { eq } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { projects, properties, views } from "@/db/schema";
import { adminOnly, broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { withProjectLock } from "@/lib/queries";
import { rankAfter } from "@/lib/rank";
import { RELEASE, releaseToReuse, ROADMAP } from "@/lib/releases";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Use releases, on: a select named Release whose options carry dates, with no
 * options yet, and a Roadmap grouped by it. A release is added when there is
 * one to plan, so nothing is guessed here.
 *
 * A dated select already there is taken instead and nothing is made: off
 * keeps the property and its views, so on again must not make a second of
 * each. One transaction under the project lock, so two presses at once
 * cannot make two. It is structure, so it is an admin's, and a person's.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  adminOnly(user, membership, "turn releases on");

  const made = await withProjectLock(projectId, async (tx) => {
    const props = await tx
      .select({
        id: properties.id,
        type: properties.type,
        config: properties.config,
        position: properties.position,
      })
      .from(properties)
      .where(eq(properties.projectId, projectId))
      .orderBy(byPos(properties.position));
    const [project] = await tx
      .select({ releaseBy: projects.releaseBy })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const reuse = releaseToReuse(
      project.releaseBy,
      props.map((p) => ({ ...p, config: p.config as { dated?: boolean } | null })),
    );
    if (reuse) {
      if (reuse !== project.releaseBy) {
        await tx.update(projects).set({ releaseBy: reuse }).where(eq(projects.id, projectId));
      }
      return false;
    }

    const [release] = await tx
      .insert(properties)
      .values({
        projectId,
        name: RELEASE,
        type: "select",
        position: rankAfter(props.at(-1)?.position ?? null),
        config: { dated: true },
      })
      .returning({ id: properties.id });

    const siblings = await tx
      .select({ position: views.position })
      .from(views)
      .where(eq(views.projectId, projectId))
      .orderBy(byPos(views.position));
    await tx.insert(views).values({
      projectId,
      name: ROADMAP,
      kind: "roadmap",
      groupById: release.id,
      position: rankAfter(siblings.at(-1)?.position ?? null),
      // A project with no view would have no main one, so the roadmap takes it.
      isDefault: siblings.length === 0,
      config: {},
    });
    await tx.update(projects).set({ releaseBy: release.id }).where(eq(projects.id, projectId));
    return true;
  });

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true }, made ? 201 : 200);
});

/**
 * Use releases, off. It clears the pointer and nothing else: the property, its
 * releases and their dates, the values on the tasks and the views all stay.
 */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const { user, membership } = await guard(projectId);
  adminOnly(user, membership, "turn releases off");
  /* Under the lock, so it cannot land between an on's read and its write. */
  await withProjectLock(projectId, (tx) =>
    tx.update(projects).set({ releaseBy: null }).where(eq(projects.id, projectId)),
  );
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});
