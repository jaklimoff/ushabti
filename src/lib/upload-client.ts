"use client";

import { api, ApiError } from "./client";
import type { AttachmentDTO } from "./types";

/**
 * One upload, as the three calls the routes make of it: ask for a row and a
 * signed PUT, put the bytes in the bucket, say "ready". A refusal at any step
 * comes back as an `ApiError` carrying the sentence to show.
 *
 * The PUT goes through `XMLHttpRequest`, because `fetch` cannot say how far
 * an upload got. `send` watches the two calls that write a row, and not the
 * PUT: a read of the task is dropped while a write is out, and a large file
 * would hold every read back for as long as it travels.
 */
export async function uploadFile(
  taskId: string,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
  send: <T>(write: () => Promise<T>) => Promise<T>,
): Promise<AttachmentDTO> {
  const asked = await send(() =>
    api.post<{ id: string; uploadUrl: string; headers: Record<string, string> }>(
      `/api/tasks/${taskId}/attachments`,
      { name: file.name, mime: file.type, size: file.size },
    ),
  );
  await put(asked.uploadUrl, asked.headers, file, onProgress, signal);
  if (signal.aborted) throw new DOMException("The upload was stopped.", "AbortError");
  const ready = await send(() =>
    api.post<{ attachment: AttachmentDTO }>(`/api/attachments/${asked.id}/ready`),
  );
  return ready.attachment;
}

function put(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.floor((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, "The bucket did not take the file."));
    };
    xhr.onerror = () => reject(new ApiError(0, "The file did not reach the bucket."));
    xhr.onabort = () => reject(new DOMException("The upload was stopped.", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    if (signal.aborted) return xhr.abort();
    xhr.send(file);
  });
}
