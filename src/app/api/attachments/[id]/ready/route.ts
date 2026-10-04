import { HttpError } from "@/lib/auth";
import { broadcast, clientIdOf, guard, json, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { attachmentRow, markReady, toAttachmentDTO } from "@/lib/attachment-rows";
import {
  attachmentsOn,
  ATTACHMENTS_OFF,
  IMAGE_HEAD_BYTES,
  imageSize,
  SIZED_IMAGES,
} from "@/lib/attachments";
import { headObject, readHead } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The uploader says the bytes are there. The bucket is asked rather than
 * believed: the object must hold the length and the mime the row promised,
 * and an image must be the image its mime names, or it stays not ready and
 * the sweep takes it.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  if (!attachmentsOn()) throw new HttpError(503, ATTACHMENTS_OFF);
  const { id } = await ctx.params;
  const row = await attachmentRow(id);
  if (!row) throw new HttpError(404, "File not found.");
  const { user } = await guard(row.projectId);
  if (row.uploaderId !== user.id) throw new HttpError(403, "Only the uploader can confirm a file.");
  if (row.readyAt) return json({ attachment: toAttachmentDTO(row) });

  const head = await headObject(row.key);
  if (!head) throw new HttpError(409, "The bucket holds no file for this upload yet.");
  if (head.size !== row.size) {
    throw new HttpError(409, `The file is ${head.size} bytes, but the upload said ${row.size}.`);
  }
  if (head.mime !== row.mime) {
    throw new HttpError(
      409,
      `The file is ${head.mime || "untyped"}, but the upload said ${row.mime}.`,
    );
  }

  let size: { width: number | null; height: number | null } = { width: null, height: null };
  if (SIZED_IMAGES.includes(row.mime)) {
    const read = imageSize(row.mime, await readHead(row.key, IMAGE_HEAD_BYTES));
    if (!read) throw new HttpError(422, `The file is not a ${row.mime} image.`);
    size = read;
  }

  const ready = await markReady(row.id, size);
  if (!ready) throw new HttpError(404, "File not found.");

  await logActivity({
    projectId: row.projectId,
    taskId: row.taskId,
    actorId: user.id,
    kind: "attachment",
    data: { action: "added", attachmentId: row.id, name: row.name },
  });
  await broadcast({
    projectId: row.projectId,
    scope: "task",
    taskId: row.taskId,
    clientId: clientIdOf(req),
  });
  return json({ attachment: toAttachmentDTO(ready) });
});
