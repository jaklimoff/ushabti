import type { PropertyDTO, TaskValue } from "./types";

/**
 * What a task waits on.
 *
 * A link is not a field on a task and not a row of the card view: it is a row
 * of its own, exactly as a run is. Nothing here names Status or Done — the
 * project says which option means over, and this reads that answer afresh.
 *
 * Everything in this file is pure. The queries live in `queries.ts` and the
 * writes in the two routes; what a link *means* lives here.
 */

/* ------------------------------------------------------------------ */
/* When a blocker stops blocking                                       */
/* ------------------------------------------------------------------ */

/** The option this project calls done: one property, one of its options. */
export type DoneWhen = { propertyId: string; optionId: string };

/**
 * The project's answer to "what does over mean", made safe to use.
 *
 * It is read afresh and never cleaned up, exactly as a filter is: nothing
 * rewrites the project when the property or the option it names is deleted.
 * A row that names either of those answers null, and null means archived —
 * the one mark the product owns, which no owner can rename away.
 *
 * Only a select can answer. A person, a date or a number has no option to
 * point at, and a checkbox would make "done" a fixed word again.
 */
export function readDoneWhen(raw: unknown, properties: PropertyDTO[]): DoneWhen | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { propertyId, optionId } = raw as { propertyId?: unknown; optionId?: unknown };
  if (typeof propertyId !== "string" || typeof optionId !== "string") return null;
  const property = properties.find((p) => p.id === propertyId);
  if (!property || property.type !== "select") return null;
  if (!property.options.some((o) => o.id === optionId)) return null;
  return { propertyId, optionId };
}

/** What a blocker has to be for this rule to read it. */
export type OverTask = {
  archivedAt: string | null;
  values: Record<string, TaskValue>;
};

/**
 * True when this task is over, so it blocks nothing any more.
 *
 * Archived always counts, whatever the project says: a task off every board
 * is not work anybody is waiting for. The named option is the other half, and
 * it is the half the owner chooses.
 */
export function isOver(task: OverTask, doneWhen: DoneWhen | null): boolean {
  if (task.archivedAt) return true;
  if (!doneWhen) return false;
  return task.values[doneWhen.propertyId] === doneWhen.optionId;
}

/* ------------------------------------------------------------------ */
/* Circles                                                             */
/* ------------------------------------------------------------------ */

/** One link: `fromId` blocks `toId`. */
export type LinkEdge = { fromId: string; toId: string };

/**
 * True when "`fromId` blocks `toId`" would close a circle.
 *
 * A circle is two tasks that each wait for the other, however many tasks
 * stand between them, and nothing in it can ever start. So the walk begins at
 * `toId` and follows what it blocks: if that reaches `fromId`, then `fromId`
 * already waits on `toId` and the new link would point back.
 *
 * An over blocker is not skipped here. Over is read afresh and changes with a
 * value; a circle written while one end was done would come back the moment
 * somebody moved it.
 *
 * It walks every link of the project once: one breadth-first pass over the
 * edges, which the caller has already read inside the transaction that writes
 * the new one. That is the price of the guard, and it is paid on a link being
 * made and on nothing else — never on a board read. A project would need tens
 * of thousands of links before the walk cost more than the round trip that
 * carried it, and a board with that many is a graph, which is out of scope.
 */
export function wouldCircle(edges: LinkEdge[], fromId: string, toId: string): boolean {
  if (fromId === toId) return true;

  const blocks = new Map<string, string[]>();
  for (const edge of edges) {
    const list = blocks.get(edge.fromId);
    if (list) list.push(edge.toId);
    else blocks.set(edge.fromId, [edge.toId]);
  }

  const seen = new Set<string>([toId]);
  const queue = [toId];
  while (queue.length) {
    const at = queue.shift()!;
    for (const next of blocks.get(at) ?? []) {
      if (next === fromId) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/** The one sentence a circle is refused with. `blocker` is what was asked for. */
export function circleSaid(blockerKey: string, taskKey: string): string {
  return `${blockerKey} already waits on ${taskKey}, so this would be a circle.`;
}

/** The one sentence a task linked to itself is refused with. */
export const SELF_LINK_SAID = "A task cannot wait on itself.";
