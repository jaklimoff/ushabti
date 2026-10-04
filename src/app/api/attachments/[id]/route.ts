import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { attachmentRow, deleteRow } from "@/lib/attachment-rows";
import { attachmentsOn, ATTACHMENTS_OFF } from "@/lib/attachments";
import { canManage } from "@/lib/roles";
import { presignGet, removeObject } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The one way to read a file. The bucket is private, so the access rule is
 * this route and `guard()`: a member of the file's project, or a token for
 * it, gets a signed URL that lasts five minutes. The link on the board is
 * this route, so it never goes stale and never opens to a stranger.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  if (!attachmentsOn()) throw new HttpError(503, ATTACHMENTS_OFF);
  const { id } = await ctx.params;
  const row = await attachmentRow(id);
  if (!row) throw new HttpError(404, "File not found.");
  await guard(row.projectId);
  if (!row.readyAt) throw new HttpError(404, "File not found.");

  const res = NextResponse.redirect(await presignGet(row), 302);
  // The signed URL is the caller's for five minutes, and nobody else's.
  res.headers.set("Cache-Control", "private, no-store");
  return res;
});

/** The uploader takes a file back; the owner or an admin takes anybody's. */
export const DELETE = route<Ctx>(async (req, ctx) => {
  if (!attachmentsOn()) throw new HttpError(503, ATTACHMENTS_OFF);
  const { id } = await ctx.params;
  const row = await attachmentRow(id);
  if (!row) throw new HttpError(404, "File not found.");
  const { user, membership } = await guard(row.projectId);
  if (row.uploaderId !== user.id && (user.kind !== "human" || !canManage(membership.role))) {
    throw new HttpError(403, "You can only delete files you added.");
  }

  const gone = await deleteRow(row.id);
  if (!gone) throw new HttpError(404, "File not found.");
  /* The row goes first, so nothing can reach the object while it goes. One
     that will not go is left behind with nothing pointing at it. */
  await removeObject(row.key).catch((err) => {
    console.error("[ushabti] could not remove a file", row.key, err);
  });

  // An upload nobody confirmed was never on the feed, so its removal is not either.
  if (row.readyAt) {
    await logActivity({
      projectId: row.projectId,
      taskId: row.taskId,
      actorId: user.id,
      kind: "attachment",
      data: { action: "removed", attachmentId: row.id, name: row.name },
    });
    await broadcast({
      projectId: row.projectId,
      scope: "task",
      taskId: row.taskId,
      clientId: clientIdOf(req),
    });
  }
  return json({ ok: true });
});
