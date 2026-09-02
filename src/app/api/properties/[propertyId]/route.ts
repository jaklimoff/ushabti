import { eq, ne, and } from "drizzle-orm";
import { byPos } from "@/lib/order";
import { db } from "@/db";
import { projects, properties, views } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { body, broadcast, clientIdOf, guard, json, ownerOnly, route, str } from "@/lib/api";
import { fallbackRow, KIND_OF_TYPE, readCardView, setCardPlace } from "@/lib/card-view";
import {
  defaultGroupById,
  loadProperties,
  propertyProjectId,
  withProjectLock,
} from "@/lib/queries";
import { rankBetween } from "@/lib/rank";

type Ctx = { params: Promise<{ propertyId: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { propertyId } = await ctx.params;
  const projectId = await propertyProjectId(propertyId);
  if (!projectId) throw new HttpError(404, "Property not found.");
  await guard(projectId);

  const input = await body<{ name?: string; showOnCard?: boolean; afterId?: string | null }>(req);
  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) patch.name = str(input.name, "Property name", { max: 40 });

  /* Where a property sits on a card belongs to the card view, so this writes
     there. It is the short way to say it: off the card, or back where its kind
     belongs. The card view page says the rest. */
  if (input.showOnCard !== undefined) {
    await setShownOnCard(projectId, propertyId, !!input.showOnCard);
  }

  if (input.afterId !== undefined) {
    await withProjectLock(projectId, async (tx) => {
      const siblings = await tx
        .select({ id: properties.id, position: properties.position })
        .from(properties)
        .where(and(eq(properties.projectId, projectId), ne(properties.id, propertyId)))
        .orderBy(byPos(properties.position));
      const index = input.afterId ? siblings.findIndex((s) => s.id === input.afterId) : -1;
      const before = index >= 0 ? siblings[index].position : null;
      const after = siblings[index + 1]?.position ?? null;
      await tx
        .update(properties)
        .set({ ...patch, position: rankBetween(before, after) })
        .where(eq(properties.id, propertyId));
    });
    await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
    return json({ ok: true });
  }

  if (Object.keys(patch).length > 0) {
    await db.update(properties).set(patch).where(eq(properties.id, propertyId));
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
  const home = fallbackRow(KIND_OF_TYPE[property.type]);
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
  ownerOnly(user, membership, "delete a property");

  // A board is meaningless without its grouping property, so deleting the
  // property would take the view with it. Say so instead of doing it quietly.
  //
  // Only a board is counted. A list remembers a property so that turning it
  // back into a board restores the same columns, but it never reads one — and
  // a remembered word must not pin a property nobody is grouping by. The
  // foreign key clears it if the property does go.
  const used = await db
    .select({ name: views.name })
    .from(views)
    .where(
      and(eq(views.projectId, projectId), eq(views.groupById, propertyId), eq(views.kind, "board")),
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

  await db.delete(properties).where(eq(properties.id, propertyId));
  await broadcast({ projectId, scope: "board", clientId: clientIdOf(req) });
  return json({ ok: true });
});
