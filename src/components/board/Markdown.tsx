"use client";

import DOMPurify from "dompurify";
import { useMemo, useRef, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";
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

  /* A plain click on a task key opens the task in the panel, as search does,
     with no page load. A click with a key held, or a middle click, is the
     browser's: the href is the task's own address.
     Any click the page answers itself never reaches the box behind, which
     would start an edit: a link, a video's controls, a details summary, or
     the end of a drag that selected words to copy. One rule, not one per
     element. */
  const before = useRef("");
  const onMouseDown = () => {
    before.current = selectedIn(null);
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!answeredHere(e.target as Element, e.currentTarget, before.current)) return;
    e.stopPropagation();
    const a = (e.target as Element).closest?.("a[data-task-key]");
    if (!a || !links) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const task = taskByAddress(links.tasks, a.getAttribute("data-task-key"));
    if (!task) return;
    e.preventDefault();
    links.open(task);
  };
  // Enter on a link or a summary clicks it; it must not also open the editor.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.target as Element).closest?.(ANSWERS_ITSELF)) {
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
      onMouseDown={onMouseDown}
      onClick={onClick}
      onKeyDown={onKeyDown}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** What the page answers on a click, with no help from us. */
const ANSWERS_ITSELF = "a, video, audio, summary";

/** The words selected, inside `words` when it is given. */
function selectedIn(words: Element | null): string {
  const sel = typeof window === "undefined" ? null : window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return "";
  if (words && !words.contains(sel.getRangeAt(0).commonAncestorContainer)) return "";
  return sel.toString();
}

/** Whether a click landed on something the page answers itself, or ended a
    drag that selected words inside these words. A click on words that were
    already selected before the press is a plain click: Chrome keeps the
    selection through it. */
function answeredHere(target: Element, words: Element, before: string): boolean {
  if (target.closest?.(ANSWERS_ITSELF)) return true;
  const now = selectedIn(words);
  return now.trim() !== "" && now !== before;
}
