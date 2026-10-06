import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { db } from "@/db";
import { projects, properties, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { GROUPED_KINDS } from "@/lib/types";
import { readCadenceInput } from "@/lib/cadence";
import { body, broadcast, clientIdOf, guard, json, adminOnly, route, str } from "@/lib/api";
import { fallbackRow, KIND_OF_TYPE, readCardView, setCardPlace } from "@/lib/card-view";
import {
  defaultGroupById,
  loadProperties,
  propertyProjectId,
  withProjectLock,
  type Tx,
} from "@/lib/queries";
import { dropHidden, lockTasks, projectTaskIds } from "@/lib/hidden";
import { rankBetween } from "@/lib/rank";
import { readWhen, readWhens } from "@/lib/when";

type Ctx = { params: Promise<{ propertyId: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { propertyId } = await ctx.params;
  const projectId = await propertyProjectId(propertyId);
  if (!projectId) throw new HttpError(404, "Property not found.");
  const { user, membership } = await guard(projectId);

  const input = await body<{
    name?: string;
    showOnCard?: boolean;
    dated?: boolean;
    cadence?: { length?: unknown; ahead?: unknown };
    when?: unknown;
    afterId?: string | null;
  }>(req);
  const patch: Record<string, unknown> = {};
  /* Each part of the config is merged onto what the part before it left, so a
     request that carries two of them keeps both. */
  let config: SQL = sql`${properties.config}`;
  let configChanged = false;
  const mergeConfig = (next: (current: SQL) => SQL) => {
    config = next(config);
    configChanged = true;
  };

  if (input.name !== undefined) patch.name = str(input.name, "Property name", { max: 40 });

  /* Whether the options carry dates is the shape of the property, so it is an
     admin's, and a person's. It is merged into the config rather than put over
     it, so nothing else the config holds is lost. */
  if (input.dated !== undefined) {
    adminOnly(user, membership, "say whether options carry dates");
    if (typeof input.dated !== "boolean") throw new HttpError(400, "Dated must be true or false.");
    const [row] = await db
      .select({ type: properties.type })
      .from(properties)
      .where(eq(properties.id, propertyId));
    // An iteration always carries dates, so the switch is a plain select's alone.
    if (row?.type !== "select") {
      throw new HttpError(400, "Only the options of a select can carry dates.");
    }
    mergeConfig((c) => sql`${c} || ${JSON.stringify({ dated: input.dated })}::jsonb`);
  }

  /* The cadence is the shape of an iteration, so it is an admin's too. Each
     half is merged into what is saved, so a blur on the length keeps the
     ahead another tab wrote. */
  if (input.cadence !== undefined) {
    adminOnly(user, membership, "change the cadence");
    if (!input.cadence || typeof input.cadence !== "object") {
      throw new HttpError(400, "The cadence must be an object with length and ahead.");
    }
    const read = readCadenceInput(input.cadence);
    if ("error" in read) throw new HttpError(400, read.error);
    const [row] = await db
      .select({ type: properties.type })
      .from(properties)
      .where(eq(properties.id, propertyId));
    if (row?.type !== "iteration") throw new HttpError(400, "Only an iteration has a cadence.");
    mergeConfig(
      (c) => sql`${c} || jsonb_build_object('cadence',
      coalesce(${properties.config} -> 'cadence', '{}'::jsonb) || ${JSON.stringify(read.patch)}::jsonb)`,
    );
  }

  /* When a property shows is the shape of the project, so it is an admin's.
     It goes through the same reader the board does, so a rule that would read
     as always shown is refused rather than kept to surprise somebody later,
     and so is one that closes a circle of rules. Null clears it. */
  if (input.when !== undefined) {
    adminOnly(user, membership, "say when a property shows");
    if (input.when === null) mergeConfig((c) => sql`(${c}) - 'when'`);
  }

  if (configChanged) patch.config = config;

  /* The rule is read under the project lock, against the rules as that lock
     sees them. Read outside it, two rules written at once each found no
     circle, and together they closed one. */
  const writeWhen = async (tx: Tx) => {
    if (input.when === undefined || input.when === null) return;
    const all = await loadProperties(projectId, tx);
    const when = readWhen(input.when, all, propertyId);
    if (!when) {
      throw new HttpError(
        400,
        "Shown when must name another select of this project and some of its options.",
      );
    }
    const after = readWhens(
      all.map((p) => (p.id === propertyId ? { ...p, config: { ...p.config, when } } : p)),
    );
    if (!after.find((p) => p.id === propertyId)?.config.when) {
      throw new HttpError(
        400,
        "That rule closes a circle: the properties in it would hide each other.",
      );
    }
    mergeConfig((c) => sql`${c} || ${JSON.stringify({ when })}::jsonb`);
    patch.config = config;
  };

  /* A rule that hides a property takes its values with it, in the same
     transaction. Settings asked first, with the count. A rule taken away
     usually shows more, but it can let a rule elsewhere out of a circle,
     and that one then hides, so a clear is checked too. */
  const dropForRule = async (tx: Tx) => {
    if (input.when === undefined) return async () => {};
    const taskIds = await projectTaskIds(tx, projectId);
    return (await dropHidden(tx, { projectId, taskIds, actorId: user.id })).ring;
  };

  const rankAfter = async (tx: Tx) => {
    const siblings = await tx
      .select({ id: properties.id, position: properties.position })
      .from(properties)
      .where(and(eq(properties.projectId, projectId), ne(properties.id, propertyId)))
      .orderBy(byPos(properties.position));
    const index = input.afterId ? siblings.findIndex((s) => s.id === input.afterId) : -1;
    const before = index >= 0 ? siblings[index].position : null;
    const after = siblings[index + 1]?.position ?? null;
    return rankBetween(before, after);
  };

  /* The rule is checked before anything is written, so a refused rule
     leaves the card view as it was too. */
  if (input.afterId !== undefined || Object.keys(patch).length > 0 || input.when !== undefined) {
    /* The project lock, as a create and an import take it: a task written
       beside a rule is either in the list the rule drops from, or reads it. */
    const ring = await withProjectLock(projectId, async (tx) => {
      await writeWhen(tx);
      const set = input.afterId === undefined ? patch : { ...patch, position: await rankAfter(tx) };
      await tx.update(properties).set(set).where(eq(properties.id, propertyId));
      return dropForRule(tx);
    });
    await ring();
  }

  /* Where a property sits on a card belongs to the card view, so this writes
     there. It is the short way to say it: off the card, or back where its kind
     belongs. The card view page says the rest. */
  if (input.showOnCard !== undefined) {
    await setShownOnCard(projectId, propertyId, !!input.showOnCard);
  }

  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});

/** Takes one property off the card, or puts it back where its kind belongs. */
async function setShownOnCard(projectId: string, propertyId: string, shown: boolean) {
  const [[project], propertyList, groupById] = await Promise.all([
    db.select({ cardView: projects.cardView }).from(projects).where(eq(projects.id, projectId)),
    loadProperties(projectId),
    defaultGroupById(projectId),
  ]);

  const property = propertyList.find((p) => p.id === propertyId);
  if (!property) return;

  const current = readCardView(project?.cardView, propertyList, groupById);
  if (!shown) {
    await db
      .update(projects)
      .set({ cardView: setCardPlace(current, propertyId, "off") })
      .where(eq(projects.id, projectId));
    return;
  }

  if (current.rows[propertyId]?.place !== "off") return;
  const fallback = fallbackRow(KIND_OF_TYPE[property.type]);
  /* A kind that starts off the card still has to land somewhere when asked
     to show: the quiet end, where every newcomer goes. */
  const home = fallback.place === "off" ? { ...fallback, place: "footerL" as const } : fallback;
  const next = {
    ...current,
    rows: { ...current.rows, [propertyId]: home },
  };
  await db.update(projects).set({ cardView: next }).where(eq(projects.id, projectId));
}

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { propertyId } = await ctx.params;
  const projectId = await propertyProjectId(propertyId);
  if (!projectId) throw new HttpError(404, "Property not found.");
  const { user, membership } = await guard(projectId);
  adminOnly(user, membership, "delete a property");

  // A board is meaningless without its grouping property, so deleting the
  // property would take the view with it. Say so instead of doing it quietly.
  //
  // Only a board and a roadmap are counted, because only they read it. A list
  // remembers a property so that turning it back into a board restores the
  // same columns, but it never reads one — and a remembered word must not pin
  // a property nobody is grouping by. The foreign key clears it if the
  // property does go.
  const used = await db
    .select({ name: views.name })
    .from(views)
    .where(
      and(
        eq(views.projectId, projectId),
        eq(views.groupById, propertyId),
        inArray(views.kind, [...GROUPED_KINDS]),
      ),
    );
  if (used.length) {
    const names = used.map((v) => `"${v.name}"`).join(", ");
    throw new HttpError(
      400,
      used.length === 1
        ? `The view ${names} groups by this property. Point it at another property first.`
        : `These views group by this property: ${names}. Point them at another property first.`,
    );
  }

  /* A rule that named this property goes with it, which can let another rule
     out of a circle to hide values on any task. So every task is checked in
     the same transaction, under the lock a rule write takes. */
  const ring = await withProjectLock(projectId, async (tx) => {
    const taskIds = await projectTaskIds(tx, projectId);
    await lockTasks(tx, taskIds);
    await tx.delete(properties).where(eq(properties.id, propertyId));
    return (await dropHidden(tx, { projectId, taskIds, actorId: user.id })).ring;
  });
  await ring();
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});
