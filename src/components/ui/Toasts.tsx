"use client";

import styles from "./ui.module.css";

export type Toast = { id: number; text: string; kind: "error" | "info" };

/**
 * Lives here rather than inside the board, because the settings page had a
 * working notify() and no way to show what it said. Every failure on that
 * page wrote to a state nothing read.
 */
export function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          className={`${styles.toast} ${toast.kind === "error" ? styles.toastError : ""}`}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}
