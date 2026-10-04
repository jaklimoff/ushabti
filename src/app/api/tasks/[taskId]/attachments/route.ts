import { HttpError } from "@/lib/auth";
import { body, guard, json, route } from "@/lib/api";
import { insertAttachment, listReady, toAttachmentDTO } from "@/lib/attachment-rows";
import {
  attachmentConfig,
  ATTACHMENTS_OFF,
  objectKey,
  putHeaders,
  readUploadAsk,
} from "@/lib/attachments";
import { taskProjectId } from "@/lib/queries";
import { presignPut } from "@/lib/storage";

type Ctx = { params: Promise<{ taskId: string }> };

/** The ready files of a task, newest first. */
export const GET = route<Ctx>(async (_req, ctx) => {
  if (!attachmentConfig().on) throw new HttpError(503, ATTACHMENTS_OFF);
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  await guard(projectId);
  const rows = await listReady(taskId);
  return json({ attachments: rows.map(toAttachmentDTO) });
});

/**
 * The first of the two calls an upload is. It writes the row, not yet ready,
 * and hands back a PUT the bucket takes only with this mime and this length.
 * Nothing is written to the feed until the bytes are there.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const config = attachmentConfig();
  if (!config.on) throw new HttpError(503, ATTACHMENTS_OFF);
  const { taskId } = await ctx.params;
  const projectId = await taskProjectId(taskId);
  if (!projectId) throw new HttpError(404, "Task not found.");
  const { user } = await guard(projectId);

  const ask = readUploadAsk(await body(req), config);
  if ("error" in ask) throw new HttpError(400, ask.error);

  const id = crypto.randomUUID();
  const row = await insertAttachment({
    id,
    projectId,
    taskId,
    uploaderId: user.id,
    key: objectKey(projectId, id),
    name: ask.name,
    mime: ask.mime,
    size: ask.size,
  });
  const uploadUrl = await presignPut(row);
  return json({ id, uploadUrl, headers: putHeaders(row.mime) }, 201);
});
