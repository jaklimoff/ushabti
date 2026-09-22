"use client";

import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, useSyncExternalStore } from "react";
import { inBrowser, onServer, tellNobody } from "@/lib/mounted";
import styles from "./panel.module.css";

marked.setOptions({ gfm: true, breaks: true });

/**
 * DOMPurify needs a real DOM, and Next renders client components on the server
 * too. Until the component is mounted in a browser we show the plain text,
 * which React escapes. The markdown is never turned into HTML without going
 * through the sanitiser first.
 */
export function Markdown({ text, testId = "markdown" }: { text: string; testId?: string }) {
  const mounted = useSyncExternalStore(tellNobody, inBrowser, onServer);

  const html = useMemo(() => {
    if (!mounted) return null;
    const raw = marked.parse(text ?? "", { async: false });
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [mounted, text]);

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
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
