import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { projects, propertyOptions, properties } from "@/db/schema";
import { readCardView } from "./card-view";
import { copiedCardView, copiedLooks, matchLook, type LookParts } from "./look";
import { defaultGroupById, loadProperties, type Tx } from "./queries";
import type { CardView } from "./types";

/**
 * The one write of a look: `target` takes `source`'s default card and the
 * icon and colour of each matched option and checkbox, by the halves ticked.
 * Copy from… and Apply to… both call it, inside a transaction that already
 * holds the target's lock; the source is only read. Nothing is made, deleted,
 * renamed or moved, and no view's own card or task changes.
 */
export async function writeLook(
  tx: Tx,
  target: string,
  source: string,
  parts: LookParts,
): Promise<CardView | null> {
  const [here, there, groupHere, groupThere, rows] = await Promise.all([
    loadProperties(target, tx),
    loadProperties(source, tx),
    defaultGroupById(target, tx),
    defaultGroupById(source, tx),
    tx
      .select({ id: projects.id, cardView: projects.cardView })
      .from(projects)
      .where(inArray(projects.id, [target, source])),
  ]);
  const savedOf = (id: string) => rows.find((r) => r.id === id)?.cardView ?? null;
  const match = matchLook(here, there);

  let written: CardView | null = null;
  if (parts.layout) {
    const mine = readCardView(savedOf(target), here, groupHere);
    const theirs = readCardView(savedOf(source), there, groupThere);
    written = readCardView(copiedCardView(mine, theirs, match), here, groupHere);
    await tx.update(projects).set({ cardView: written }).where(eq(projects.id, target));
  }

  if (parts.looks) {
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
        .where(and(eq(properties.id, c.id), eq(properties.projectId, target)));
    }
  }
  return written;
}
