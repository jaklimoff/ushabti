"use client";

import { useState } from "react";
import { formatBytes, isImage, isInline } from "@/lib/attachments";
import { api } from "@/lib/client";
import { canManage } from "@/lib/roles";
import type { AttachmentDTO } from "@/lib/types";
import { ConfirmRow } from "@/components/ui/ConfirmRow";
import { useBoard } from "./store";
import styles from "./panel.module.css";

type Send = <T>(write: () => Promise<T>) => Promise<T>;

/**
 * The task's files, newest first, under the description. A press opens one
 * in a new tab through its route, which checks the project. The uploader
 * takes a file back, and the owner or an admin takes anybody's, as the route
 * says. A task with no files draws nothing.
 */
export function FilesStrip({
  files,
  meId,
  send,
  reload,
  onError,
}: {
  files: AttachmentDTO[];
  meId: string;
  send: Send;
  reload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { data } = useBoard();
  const admin = canManage(data.project.role);
  const [asking, setAsking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  if (files.length === 0) return null;

  async function remove(file: AttachmentDTO) {
    // A second press while the first is out removes nothing twice.
    if (removing) return;
    setRemoving(file.id);
    try {
      await send(() => api.del(`/api/attachments/${file.id}`));
      setAsking(null);
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "The file was not removed.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className={styles.block} data-testid="files">
      <div className={styles.blockHead}>
        <span className="label">Files</span>
      </div>
      <ul className={styles.files}>
        {files.map((file) =>
          asking === file.id ? (
            <li key={file.id} className={styles.fileAsk}>
              <ConfirmRow
                question={`Remove ${file.name}? Every link to it in this task stops working.`}
                confirmLabel="Yes, remove"
                pending={removing === file.id}
                onConfirm={() => void remove(file)}
                onCancel={() => setAsking(null)}
              />
            </li>
          ) : (
            <li key={file.id} className={styles.file} data-testid="file">
              <a
                className={styles.fileOpen}
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${file.name}`}
              >
                <Thumb file={file} />
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileSize}>{formatBytes(file.size)}</span>
              </a>
              {(file.uploaderId === meId || admin) && (
                <button
                  className={styles.linkRemove}
                  aria-label={`Remove ${file.name}`}
                  title="Remove"
                  onClick={() => setAsking(file.id)}
                >
                  ✕
                </button>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/* An image shows itself, a video its first frame, anything else the letters
   of its kind. SVG is not shown in place, as the route says. */
function Thumb({ file }: { file: AttachmentDTO }) {
  if (isImage(file.mime)) {
    // The route redirects to a signed URL Next's loader cannot fetch or cache.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={styles.fileThumb} src={file.url} alt="" loading="lazy" />;
  }
  if (isInline(file.mime)) {
    return <video className={styles.fileThumb} src={file.url} preload="metadata" muted />;
  }
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.slice(0, 4) : "file";
  return <span className={`${styles.fileThumb} ${styles.fileKind}`}>{ext}</span>;
}
