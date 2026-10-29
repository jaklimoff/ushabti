"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button";
import { Input } from "./Form";
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
 *
 * `typed` is a question answered by typing a word, for a loss so large that a
 * second press is not enough: deleting a whole project. The danger button
 * stays off until the box holds the word, and the focus starts in the box.
 * It is the same row, so every destructive question off the board has one look.
 * A column head asks in the board's own compact form instead: it is narrower
 * than a page row, and its ship question needs more than one answer.
 *
 * `unasked` is a question nobody pressed a button for: a blur raised it, so
 * the next key may still be a stray one. The focus waits on the way back.
 */
export function ConfirmRow({
  question,
  confirmLabel = "Yes, delete",
  cancelLabel = "Cancel",
  pending = false,
  unasked = false,
  typed,
  onConfirm,
  onCancel,
}: {
  question: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** True when the row came up without a press, so Enter must not answer yes. */
  unasked?: boolean;
  /** True while the question does not yet name what it costs. */
  pending?: boolean;
  /** The word to type before the danger button turns on, and the box's name. */
  typed?: { word: string; label: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const said = useId();
  const [text, setText] = useState("");
  /* A key is capitals, so the box writes capitals and a lower-case answer is
     not a wrong one. */
  const typing = typed !== undefined;
  const matched = !typed || text === typed.word.toUpperCase();

  useEffect(() => {
    /* A typed question starts in its box, and its button is off until the
       word is there, so there is nowhere to move the focus to. */
    if (pending || typing || unasked) return;
    const node = row.current;
    // Only if the focus is still in this row: somebody who walked away while
    // the numbers were coming keeps where they went.
    if (!node || !node.contains(document.activeElement)) return;
    node.querySelector<HTMLButtonElement>("[data-confirm-yes]")?.focus();
  }, [pending, typing, unasked]);

  return (
    <div
      ref={row}
      className={styles.confirm}
      role="alertdialog"
      /* A plain question names the row itself; one with a word set apart in
         it is named by its words. */
      aria-label={typeof question === "string" ? question : undefined}
      aria-labelledby={typeof question === "string" ? undefined : said}
    >
      <span id={said} className={styles.confirmText}>
        {question}
      </span>
      {/* The answers wrap as one, so a long question never leaves one of
          them alone on the next line. */}
      <span className={styles.confirmActions}>
        {typed && (
          <Input
            autoFocus
            width="short"
            className={styles.confirmInput}
            aria-label={typed.label}
            value={text}
            onChange={(e) => setText(e.target.value.toUpperCase())}
          />
        )}
        <Button
          variant="danger"
          data-confirm-yes=""
          autoFocus={!pending && !typed && !unasked}
          disabled={pending || !matched}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" autoFocus={pending || unasked} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </span>
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
