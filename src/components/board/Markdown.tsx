"use client";

import DOMPurify from "dompurify";
import { useMemo, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";
import { taskByAddress } from "@/lib/board";
import { inBrowser, onServer, tellNobody } from "@/lib/mounted";
import { renderMarkdown } from "@/lib/task-keys";
import styles from "./panel.module.css";

/** A task a key can open: which one, and the key its link carries. */
type Openable = { id: string; key: string };

/** What the markdown needs to draw a task key as a link, and to open it. */
export type TaskKeyLinks = {
  projectId: string;
  projectKey: string;
  /** Every task a key may name: the board and the archive. */
  tasks: Openable[];
  open: (task: Openable) => void;
};

/**
 * DOMPurify needs a real DOM, and Next renders client components on the server
 * too. Until the component is mounted in a browser we show the plain text,
 * which React escapes. The markdown is never turned into HTML without going
 * through the sanitiser first.
 */
export function Markdown({
  text,
  testId = "markdown",
  links = null,
}: {
  text: string;
  testId?: string;
  links?: TaskKeyLinks | null;
}) {
  const mounted = useSyncExternalStore(tellNobody, inBrowser, onServer);
  const projectId = links?.projectId;
  const projectKey = links?.projectKey;
  /* Every board read brings a new list of tasks. The keys in it rarely
     change, so the text is parsed again only when they do. */
  const keys = useMemo(() => links?.tasks.map((t) => t.key).join(" ") ?? null, [links?.tasks]);

  const html = useMemo(() => {
    if (!mounted) return null;
    const known =
      projectId && projectKey && keys !== null
        ? { projectId, projectKey, keys: keys ? keys.split(" ") : [] }
        : null;
    return DOMPurify.sanitize(renderMarkdown(text, known), { USE_PROFILES: { html: true } });
  }, [mounted, text, projectId, projectKey, keys]);

  /* A plain click opens the task in the panel, as search does, with no page
     load. A click with a key held, or a middle click, is the browser's: the
     href is the task's own address. The click never reaches the description
     behind it, which would start an edit. */
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as Element).closest?.("a[data-task-key]");
    if (!a || !links) return;
    e.stopPropagation();
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const task = taskByAddress(links.tasks, a.getAttribute("data-task-key"));
    if (!task) return;
    e.preventDefault();
    links.open(task);
  };
  // Enter on a link clicks it; it must not also open the editor behind it.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.target as Element).closest?.("a[data-task-key]")) {
      e.stopPropagation();
    }
  };

  if (html === null) {
    return (
      <div className={styles.markdown} data-testid={testId} style={{ whiteSpace: "pre-wrap" }}>
        {text}
      </div>
    );
  }

  return (
    <div
      className={styles.markdown}
      data-testid={testId}
      onClick={onClick}
      onKeyDown={onKeyDown}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
