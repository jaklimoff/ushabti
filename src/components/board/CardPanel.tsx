"use client";

import { useEffect, useRef, useState } from "react";
import { CardEditor } from "@/components/settings/CardViewPanel";
import { Button } from "@/components/ui/Button";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { isTyping } from "./keys";
import { useBoard } from "./store";
import styles from "./panel.module.css";

/** "A", "A and B", "A, B and C". */
function namesSaid(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The card editor, beside the board it arranges. One board card on the
 * stand-in task sits above it, because the cards behind may hold too little
 * to show a row, and the drawing alone reads as a card twice their size. It
 * edits the open view's card, or the project's when asked to,
 * through the same store calls the Settings page makes, so no new route.
 */
export function CardPanel({ onClose }: { onClose: () => void }) {
  const { data, view, resetCardView } = useBoard();
  /* The default is edited for one view at a time: another view opens on its
     own card again, without an effect to put it back. */
  const [onDefault, setOnDefault] = useState<string | null>(null);
  const confirm = useConfirm();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      /* A lifted chip puts itself back on Escape, and an open chip menu
         closes on it; both have answered the key already. */
      if (event.key === "Escape" && !event.defaultPrevented && !isTyping(event.target)) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  if (!view || view.kind === "roadmap") return null;

  const own = view.cardView != null;
  const project = onDefault === view.id && !own;
  /* The other views that draw the default, so the line names who else a
     change to it reaches. A roadmap draws no card. */
  const others = data.views
    .filter((v) => v.id !== view.id && v.kind !== "roadmap" && v.cardView == null)
    .map((v) => v.name);

  return (
    <aside
      className={`${styles.panel} ${styles.cardPanel}`}
      data-testid="card-panel"
      ref={panelRef}
      tabIndex={-1}
      aria-label="Card"
    >
      <div className={styles.head}>
        <div className={styles.headRow}>
          <h2 className={styles.optionName}>Card</h2>
          <span style={{ flex: 1 }} />
          <button
            className={styles.iconButton}
            aria-label="Close the card"
            title="Close (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className={styles.cardPanelSub}>How a card reads on {view.name}</div>
      </div>

      <div className={styles.body}>
        <div className={styles.cardPanelNote} data-testid="card-panel-note">
          {confirm.asking ? (
            <ConfirmRow
              question={`Use the default for ${view.name}? Its own card goes, and it draws the default again.`}
              confirmLabel="Yes, use the default"
              onConfirm={() => confirm.confirm(() => void resetCardView(view.id))}
              onCancel={confirm.cancel}
            />
          ) : project ? (
            <>
              <span>
                This is the default card. {namesSaid([view.name, ...others])}{" "}
                {others.length === 0 ? "draws" : "draw"} it.
              </span>
              <Button variant="ghost" onClick={() => setOnDefault(null)}>
                Back to {view.name}
              </Button>
            </>
          ) : own ? (
            <>
              <span>
                {view.name} has a card of its own. A change to the default does not reach it.
              </span>
              <Button variant="ghost" onClick={confirm.ask}>
                Use the default
              </Button>
            </>
          ) : (
            <>
              <span>
                {view.name} follows the default card
                {others.length > 0 ? `, with ${namesSaid(others)}` : ""}. Your first change here
                gives {view.name} a card of its own.
              </span>
              <Button variant="ghost" onClick={() => setOnDefault(view.id)}>
                Change the default instead
              </Button>
            </>
          )}
        </div>
        <div className={styles.cardPanelEditor}>
          {/* Keyed, so a chip menu open on one card does not stay open on the other. */}
          <CardEditor
            key={project ? "default" : view.id}
            viewId={project ? null : view.id}
            bare
            sample
            startOn={!project && view.kind === "list" ? "list" : "card"}
          />
        </div>
      </div>
    </aside>
  );
}
