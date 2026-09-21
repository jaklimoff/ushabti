import "server-only";
import { db } from "@/db";
import { activity } from "@/db/schema";

/**
 * The one funnel every change goes through.
 *
 * It sits in its own module because `runs.ts` writes activity too, and
 * `queries.ts` already reads `runs.ts`. Anything hung on this funnel later — a
 * webhook, a digest — then fires for a run the lease closed as well, without
 * the two modules importing each other.
 */
export async function logActivity(entry: {
  projectId: string;
  taskId?: string | null;
  actorId: string;
  kind: string;
  data?: Record<string, unknown>;
}) {
  await db.insert(activity).values({
    projectId: entry.projectId,
    taskId: entry.taskId ?? null,
    actorId: entry.actorId,
    kind: entry.kind,
    data: entry.data ?? {},
  });
}
