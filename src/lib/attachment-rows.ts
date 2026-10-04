import "server-only";
import { and, desc, eq, gt, isNotNull, isNull, lt, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { attachments, tasks } from "@/db/schema";
import { attachmentsOn, UNREADY_TTL_MS } from "./attachments";
import { readId } from "./api";
import type { AttachmentDTO } from "./types";

export type { AttachmentDTO };

export type AttachmentRow = typeof attachments.$inferSelect;

export function toAttachmentDTO(row: AttachmentRow): AttachmentDTO {
  return {
    id: row.id,
    taskId: row.taskId,
    uploaderId: row.uploaderId,
    name: row.name,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
    url: `/api/attachments/${row.id}`,
  };
}

/**
 * One file, unless its task is in the drawer. A deleted task is hidden from
 * every route, as `taskProjectId` hides it, and its files go with it until a
 * put back brings both.
 */
export async function attachmentRow(id: string): Promise<AttachmentRow | null> {
  readId(id, "attachment");
  const [row] = await db
    .select({ attachment: attachments })
    .from(attachments)
    .innerJoin(tasks, eq(tasks.id, attachments.taskId))
    .where(and(eq(attachments.id, id), isNull(tasks.deletedAt)))
    .limit(1);
  return row?.attachment ?? null;
}

export async function insertAttachment(
  row: typeof attachments.$inferInsert,
): Promise<AttachmentRow> {
  const [made] = await db.insert(attachments).values(row).returning();
  return made;
}

/**
 * Marks an upload ready, unless the sweep's hour has passed. It names the
 * state it changes from, so a second "ready" writes nothing and answers null,
 * and so does one that arrives after the sweep could have taken the row.
 */
export async function markReady(
  id: string,
  size: { width: number | null; height: number | null },
): Promise<AttachmentRow | null> {
  const [row] = await db
    .update(attachments)
    .set({ readyAt: new Date(), width: size.width, height: size.height })
    .where(
      and(
        eq(attachments.id, id),
        isNull(attachments.readyAt),
        gt(attachments.createdAt, new Date(Date.now() - UNREADY_TTL_MS)),
      ),
    )
    .returning();
  return row ?? null;
}

/** The ready files of a task, newest first. */
export async function listReady(taskId: string): Promise<AttachmentRow[]> {
  return db
    .select()
    .from(attachments)
    .where(and(eq(attachments.taskId, taskId), isNotNull(attachments.readyAt)))
    .orderBy(desc(attachments.createdAt), desc(attachments.id));
}

/** Removes a row and answers it, or null when somebody else removed it first. */
export async function deleteRow(id: string): Promise<AttachmentRow | null> {
  const [row] = await db.delete(attachments).where(eq(attachments.id, id)).returning();
  return row ?? null;
}

/**
 * Removes the uploads nobody confirmed within the hour, with their objects.
 *
 * It runs where `sweepLost` runs, on the read of the board and of a task,
 * for the same reason: the board is read far more often than a schedule
 * would fire. The row goes first, in one statement, so a late "ready" finds
 * nothing to confirm. An object that will not go is left behind; the row
 * that pointed at it is gone, so nobody can reach it.
 *
 * It never throws and never waits on the bucket: a bucket that is slow or
 * down must not hold the board.
 */
export async function sweepUnready(scope: { projectId: string } | { taskId: string }) {
  if (!attachmentsOn()) return;
  const where: SQL =
    "projectId" in scope
      ? eq(attachments.projectId, scope.projectId)
      : eq(attachments.taskId, scope.taskId);
  try {
    const gone = await db
      .delete(attachments)
      .where(
        and(
          where,
          isNull(attachments.readyAt),
          lt(attachments.createdAt, new Date(Date.now() - UNREADY_TTL_MS)),
        ),
      )
      .returning({ key: attachments.key });
    removeObjects(gone.map((row) => row.key));
  } catch (err) {
    console.error("[ushabti] the upload sweep failed", err);
  }
}

/**
 * Removes objects whose rows are already gone, all at once and without
 * waiting: nothing can reach them any more, so the caller has no reason to
 * wait on the bucket. One that will not go is logged and left. The S3 client
 * is loaded only when there is something to remove, so a server with no
 * bucket never loads it.
 */
export function removeObjects(keys: string[]): void {
  if (keys.length === 0 || !attachmentsOn()) return;
  void import("./storage").then(({ removeObject }) =>
    Promise.allSettled(
      keys.map((key) =>
        removeObject(key).catch((err) => {
          console.error("[ushabti] could not remove a file from the bucket", key, err);
        }),
      ),
    ),
  );
}
