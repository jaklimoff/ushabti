"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import styles from "./ui.module.css";

/**
 * The board has no dialogs, so a destructive control turns its own row into
 * the question. The question always names what is lost, in real numbers,
 * because "are you sure?" tells nobody anything.
 *
 * `pending` is a question whose numbers are still coming. It cannot be
 * answered yet — that is the whole of this row — so the danger button is off
 * and the focus waits on Cancel. When the numbers land the focus moves on, so
 * a keyboard reaches the same button it always did, one press later.
 */
export function ConfirmRow({
  question,
  confirmLabel = "Yes, delete",
  pending = false,
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel?: string;
  /** True while the question does not yet name what it costs. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pending) return;
    const node = row.current;
    // Only if the focus is still in this row: somebody who walked away while
    // the numbers were coming keeps where they went.
    if (!node || !node.contains(document.activeElement)) return;
    node.querySelector<HTMLButtonElement>("[data-confirm-yes]")?.focus();
  }, [pending]);

  return (
    <div ref={row} className={styles.confirm} role="alertdialog" aria-label={question}>
      <span className={styles.confirmText}>{question}</span>
      <span className={styles.spacer} />
      <Button
        variant="danger"
        data-confirm-yes=""
        autoFocus={!pending}
        disabled={pending}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" autoFocus={pending} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** Holds the "the row is asking" flag, so every caller does it the same way. */
export function useConfirm() {
  const [asking, setAsking] = useState(false);
  return {
    asking,
    ask: () => setAsking(true),
    cancel: () => setAsking(false),
    /** Runs the action and puts the row back. */
    confirm: (run: () => void) => {
      setAsking(false);
      run();
    },
  };
}
