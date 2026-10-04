"use client";

import DOMPurify from "dompurify";
import { useMemo, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";
import { taskByAddress } from "@/lib/board";
import { inBrowser, onServer, tellNobody } from "@/lib/mounted";
import { renderMarkdown } from "@/lib/task-keys";
import { allowedVideoSrc, type FileFacts } from "@/lib/uploads";
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

/*
 * A `<video>` passes on purpose, and only for a file of this board: anywhere
 * else a description could make every reader's browser fetch a stranger's
 * address. `<source>` and `<track>` would name an address the check never
 * reads, and `poster` is one more, so none of them pass. Nor does `<audio>`,
 * which nothing on the board writes. The hook goes on once, the first time a browser
 * sanitises.
 */
let hooked = false;
function sanitise(html: string): string {
  if (!hooked) {
    DOMPurify.addHook("uponSanitizeElement", (node, data) => {
      if (data.tagName !== "video") return;
      const el = node as Element;
      if (!allowedVideoSrc(el.getAttribute("src"))) el.parentNode?.removeChild(el);
      else el.removeAttribute("poster");
    });
    hooked = true;
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["video"],
    ADD_ATTR: ["controls", "preload"],
    FORBID_TAGS: ["source", "track", "audio"],
    FORBID_ATTR: ["poster"],
  });
}

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
  files = null,
}: {
  text: string;
  testId?: string;
  links?: TaskKeyLinks | null;
  /** The task's own files, which say how a file the text names is drawn. */
  files?: FileFacts[] | null;
}) {
  const mounted = useSyncExternalStore(tellNobody, inBrowser, onServer);
  const projectId = links?.projectId;
  const projectKey = links?.projectKey;
  /* Every board read brings a new list of tasks. The keys in it rarely
     change, so the text is parsed again only when they do. */
  const keys = useMemo(() => links?.tasks.map((t) => t.key).join(" ") ?? null, [links?.tasks]);

  /* The same for the files: a read brings a new list, and what a file looks
     like changes only when one comes or goes. */
  const shown = useMemo(
    () =>
      files
        ? JSON.stringify(files.map(({ id, name, mime, size }) => [id, name, mime, size]))
        : null,
    [files],
  );

  const html = useMemo(() => {
    if (!mounted) return null;
    const known =
      projectId && projectKey && keys !== null
        ? { projectId, projectKey, keys: keys ? keys.split(" ") : [] }
        : null;
    const list = shown
      ? (JSON.parse(shown) as [string, string, string, number][]).map(([id, name, mime, size]) => ({
          id,
          name,
          mime,
          size,
        }))
      : null;
    return sanitise(renderMarkdown(text, known, list));
  }, [mounted, text, projectId, projectKey, keys, shown]);

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
