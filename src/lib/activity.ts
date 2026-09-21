import "server-only";
import { db } from "@/db";
import { activity } from "@/db/schema";
import { kickSender, queueWebhooks, type Rung } from "./webhooks";

/**
 * The one funnel every change goes through.
 *
 * It sits in its own module because `runs.ts` writes activity too, and
 * `queries.ts` already reads `runs.ts`. Anything hung on this funnel — the
 * webhooks below, a digest later — then fires for a run the lease closed as
 * well, without the two modules importing each other.
 */

export type ActivityEntry = {
  projectId: string;
  taskId?: string | null;
  actorId: string;
  kind: string;
  data?: Record<string, unknown>;
};

export async function logActivity(entry: ActivityEntry) {
  await logActivityAll([entry]);
}

/**
 * Several lines at once, for a write that touches many tasks.
 *
 * The archive of a whole column writes one line on each card, and it writes
 * them here rather than by hand: a line that skips the funnel rings no
 * webhook, and the owner sweeping a column is exactly the change an outside
 * service wants to hear about. One INSERT either way.
 */
export async function logActivityAll(entries: ActivityEntry[]) {
  if (entries.length === 0) return;

  /* One moment for the whole call, written on the row rather than left to
     the database. The webhook that rings names it, and a receiver that reads
     the feed `after` that moment must land exactly on this line: a stamp a
     millisecond later would step over the very line it rang about. */
  const at = new Date();
  await db.insert(activity).values(
    entries.map((entry) => ({
      projectId: entry.projectId,
      taskId: entry.taskId ?? null,
      actorId: entry.actorId,
      kind: entry.kind,
      data: entry.data ?? {},
      createdAt: at,
    })),
  );

  /* The doorbell, never the change. It writes rows and touches no network, so
     the caller's write is already over by the time anything is sent. A ring
     that cannot be queued is lost, exactly as an event on a dropped socket
     is: the feed is the record, and a receiver reads it to catch up. */
  try {
    const rung: Rung[] = entries.map((entry) => ({
      projectId: entry.projectId,
      taskId: entry.taskId ?? null,
      kind: entry.kind,
      at,
    }));
    await queueWebhooks(rung);
    kickSender();
  } catch {
    // A webhook must never break the write that caused it.
  }
}
