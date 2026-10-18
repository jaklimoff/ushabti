"use client";

import { IconButton } from "./Button";
import { ConfirmRow, useConfirm } from "./ConfirmRow";
import styles from "./TokenRow.module.css";

/**
 * One token: its name and prefix, then its dates, with the ✕ that revokes it.
 * Account and Settings → People list tokens of two kinds, and used to draw
 * two rows that looked related and were not. What sits under the row (a
 * fresh secret, the connect recipe) comes in as children.
 */
export function TokenRow({
  name,
  prefix,
  meta,
  question,
  onRevoke,
  fresh = false,
  testId,
  children,
}: {
  name: string;
  prefix: string;
  /** The dates line: made, expires, last used. */
  meta: React.ReactNode;
  /** What the confirm row asks, naming what stops working. */
  question: string;
  /** Null where the reader may not revoke it. */
  onRevoke: (() => void) | null;
  /** The row just made, while its secret sits under it. */
  fresh?: boolean;
  testId: string;
  children?: React.ReactNode;
}) {
  const confirm = useConfirm();

  if (confirm.asking && onRevoke) {
    return (
      <div className={styles.item}>
        <ConfirmRow
          question={question}
          confirmLabel="Yes, revoke"
          onConfirm={() => confirm.confirm(onRevoke)}
          onCancel={confirm.cancel}
        />
      </div>
    );
  }

  return (
    <div className={fresh ? `${styles.item} ${styles.fresh}` : styles.item}>
      <div className={styles.row} data-testid={testId}>
        <div className={styles.line}>
          <span className={styles.name} title={name}>
            {name}
          </span>
          <span className={styles.prefix}>{prefix}…</span>
        </div>
        <span className={styles.meta}>{meta}</span>
        {onRevoke && (
          <IconButton
            className={styles.revoke}
            danger
            label={`Revoke the token ${name}`}
            title="Revoke this token"
            onClick={confirm.ask}
          >
            ✕
          </IconButton>
        )}
      </div>
      {children}
    </div>
  );
}
