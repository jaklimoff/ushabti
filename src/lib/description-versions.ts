import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { descriptionVersions, users } from "@/db/schema";
import type { Tx } from "./queries";

/** How long one actor's edits keep folding into the version they started. */
export const BURST_MS = 10 * 60 * 1000;

/**
 * Keeps the text a description write replaced, and answers the version id.
 *
 * Edits in a burst share one version: when the newest version of the task is
 * the same actor's, younger than `BURST_MS`, and left the very text being
 * replaced, its `after` moves and no row is made. Somebody typing a long
 * description in several saves then reads as one edit, while every save still
 * writes its own line, because the watcher reads lines. A put-back always
 * makes its own version and is never moved, so the put-back stays a thing a
 * person can see and undo.
 *
 * The caller holds the task's row lock, so the newest version cannot change
 * under this read.
 */
export async function keepVersion(
  tx: Tx,
  v: {
    taskId: string;
    actorId: string;
    before: string;
    after: string;
    restoredFrom: string | null;
  },
): Promise<string> {
  const now = new Date();
  if (!v.restoredFrom) {
    const [last] = await tx
      .select({
        id: descriptionVersions.id,
        actorId: descriptionVersions.actorId,
        after: descriptionVersions.after,
        restoredFrom: descriptionVersions.restoredFrom,
        createdAt: descriptionVersions.createdAt,
      })
      .from(descriptionVersions)
      .where(eq(descriptionVersions.taskId, v.taskId))
      .orderBy(desc(descriptionVersions.createdAt), desc(descriptionVersions.id))
      .limit(1);
    if (
      last &&
      last.actorId === v.actorId &&
      last.restoredFrom === null &&
      last.after === v.before &&
      now.getTime() - last.createdAt.getTime() < BURST_MS
    ) {
      await tx
        .update(descriptionVersions)
        .set({ after: v.after })
        .where(eq(descriptionVersions.id, last.id));
      return last.id;
    }
  }
  const [made] = await tx
    .insert(descriptionVersions)
    .values({
      taskId: v.taskId,
      actorId: v.actorId,
      before: v.before,
      after: v.after,
      restoredFrom: v.restoredFrom,
      createdAt: now,
    })
    .returning({ id: descriptionVersions.id });
  return made.id;
}

export type DescriptionVersionDTO = {
  id: string;
  before: string;
  after: string;
  createdAt: string;
  actor: { id: string; name: string; kind: "human" | "agent" } | null;
};

/** One version of one task, or null when the id names another task's. */
export async function readVersion(
  taskId: string,
  versionId: string,
): Promise<DescriptionVersionDTO | null> {
  const [row] = await db
    .select({
      id: descriptionVersions.id,
      before: descriptionVersions.before,
      after: descriptionVersions.after,
      createdAt: descriptionVersions.createdAt,
      actorId: users.id,
      actorName: users.name,
      actorKind: users.kind,
    })
    .from(descriptionVersions)
    .leftJoin(users, eq(users.id, descriptionVersions.actorId))
    .where(and(eq(descriptionVersions.id, versionId), eq(descriptionVersions.taskId, taskId)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
    actor: row.actorId
      ? {
          id: row.actorId,
          name: row.actorName ?? "",
          kind: row.actorKind === "agent" ? "agent" : "human",
        }
      : null,
  };
}
