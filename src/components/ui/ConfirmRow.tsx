"use client";

import { useState } from "react";
import { Button } from "./Button";
import styles from "./ui.module.css";

/**
 * The board has no dialogs, so a destructive control turns its own row into
 * the question. The question always names what is lost, in real numbers,
 * because "are you sure?" tells nobody anything.
 */
export function ConfirmRow({
  question,
  confirmLabel = "Yes, delete",
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.confirm} role="alertdialog" aria-label={question}>
      <span className={styles.confirmText}>{question}</span>
      <span className={styles.spacer} />
      <Button variant="danger" autoFocus onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
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
