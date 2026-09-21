"use client";

import { forwardRef, useMemo } from "react";
import type { AgentRunDTO, TaskDTO } from "@/lib/types";
import { buildCard, type CardChip } from "@/lib/card-view";
import { isOpen, lifeOf, runClock, runIsStill, runLine } from "@/lib/run-state";
import { useNow } from "@/components/ui/useElapsed";
import { Chip } from "./Chip";
import { useBoard } from "./store";
import styles from "./board.module.css";

type Props = {
  task: TaskDTO;
  selected?: boolean;
  /** This card carries the board cursor, so it is the board's tab stop. */
  cursor?: boolean;
  ghost?: boolean;
  overlay?: boolean;
  onOpen?: () => void;
  /**
   * Picks this card, or puts it back: the check in the corner, and a
   * Shift-click anywhere on the card. The event says which, because a range
   * is only a range when Shift is down. Absent on the drag overlay, which is
   * a picture of a card rather than one.
   */
  onPick?: (event: React.MouseEvent) => void;
  style?: React.CSSProperties;
  dragProps?: Record<string, unknown>;
};

/**
 * A card draws what the card view asks for and nothing else. Which rows those
 * are, where they sit and how they read all live in the project's card view,
 * which the settings page arranges; this file only knows how to draw a chip.
 */
export const TaskCard = forwardRef<HTMLDivElement, Props>(function TaskCard(
  { task, selected, cursor, ghost, overlay, onOpen, onPick, style, dragProps },
  ref,
) {
  const { cardItems, data, isPicked, picked, runOf } = useBoard();
  const run = runOf(task.id);

  /* The card wears a border and nothing more. The check stays on the whole
     board while anything is picked, so the way out of a pick is where the way
     in was, on every card at once. The store answers from a set, because every
     card asks this every time the board draws. */
  const mine = isPicked(task.id);
  const picking = picked.length > 0;

  const slots = useMemo(
    () => buildCard(cardItems, task, data.members),
    [cardItems, data.members, task],
  );

  /* One glyph, and never a list. A card with ten runs on it has to stay
     readable, and so does a board where half the cards are waiting. What it
     waits on is in the tooltip and in the panel. It is not a row of the card
     view and never will be: a link is not a field, as a run is not. */
  const blocked = task.blockedBy.length > 0;

  const hasHeader = blocked || slots.headerL.length > 0 || slots.headerR.length > 0;
  const hasBody = slots.body !== null || slots.bodyChips.length > 0;
  const hasFooter = slots.footerL.length > 0 || slots.footerR.length > 0;

  const className = [
    styles.card,
    slots.edge ? styles.cardEdged : "",
    mine ? styles.cardPicked : "",
    selected ? styles.cardSelected : "",
    ghost ? styles.cardGhost : "",
    overlay ? styles.cardOverlay : "",
  ]
    .filter(Boolean)
    .join(" ");

  // dnd-kit puts its keyboard handler in dragProps. Ours has to run after it,
  // and only when the drag sensor did not already claim the key.
  const dragKeyDown = dragProps?.onKeyDown as
    ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;

  return (
    <div
      ref={ref}
      className={className}
      data-testid={overlay ? "card-overlay" : "card"}
      style={style}
      data-task-id={task.id}
      data-picked={mine ? "true" : undefined}
      /* A plain click still opens the task. Shift is what says "and this one
         too", so it never opens anything. */
      onClick={(event: React.MouseEvent) => {
        if (event.shiftKey && onPick) return onPick(event);
        onOpen?.();
      }}
      /* A Shift-mousedown means "and the ones in between", never "select the
         words in between", so the browser's own text selection is stopped
         before it starts. Without it a range leaves the table striped blue
         from the heading down. */
      onMouseDown={(event: React.MouseEvent) => {
        if (event.shiftKey) event.preventDefault();
      }}
      role="button"
      {...dragProps}
      /* dnd-kit hands every card a tab stop. The board keeps one, so Tab
         reaches the cursor in one press and the arrow keys move it. */
      tabIndex={cursor && !overlay ? 0 : -1}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        dragKeyDown?.(event);
        if (event.key === "Enter" && !event.defaultPrevented && onOpen) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {onPick && !overlay && (
        /* It sits over the corner rather than in the strip: a place of its own
           would move every chip on the card the moment a pointer arrived, and
           the card is supposed to hold still. */
        <button
          className={styles.cardPick}
          data-testid="card-pick"
          /* The button is where it is pressed; the box inside it is what is
             drawn. Where there is no hover the button is a 24 px square and
             the box is the same check it always was. */
          data-on={picking ? "true" : undefined}
          aria-pressed={mine}
          aria-label={mine ? `Leave ${task.key} out` : `Pick ${task.key}`}
          /* The board has one tab stop, which is the card carrying the cursor.
             Forty checks would give it forty-one. `x` is the keyboard way in,
             exactly as the grip in settings is the keyboard way to drag. */
          tabIndex={-1}
          /* The card is the drag handle and this button sits on top of it. */
          onPointerDown={(event) => event.stopPropagation()}
          /* The press must not move the focus off the cursor card. */
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onPick(event);
          }}
        >
          <span className={styles.cardPickBox} data-testid="card-pick-box" aria-hidden>
            {mine ? "✓" : ""}
          </span>
        </button>
      )}

      {slots.edge && (
        <span
          className={styles.cardEdge}
          data-testid="card-edge"
          style={{ background: slots.edge }}
          aria-hidden
        />
      )}

      {hasHeader && (
        <Strip left={slots.headerL} right={slots.headerR} className={styles.cardTop}>
          {/* Before the key, because the key is what it sits beside and a
              header is read from the left. */}
          {blocked && (
            <span
              className={styles.cardChain}
              data-testid="card-chain"
              title={`Blocked by ${task.blockedBy.join(", ")}`}
              aria-label={`Blocked by ${task.blockedBy.join(", ")}`}
              role="img"
            >
              ⛓
            </span>
          )}
        </Strip>
      )}

      <div className={styles.cardTitle} data-testid="card-title">
        {task.title}
      </div>

      {hasBody && (
        <div className={styles.cardBody}>
          {slots.body && (
            <span
              className={styles.cardDesc}
              data-testid="card-desc"
              style={{ WebkitLineClamp: slots.body.lines }}
            >
              {slots.body.text}
            </span>
          )}
          {slots.bodyChips.length > 0 && (
            <span className={styles.cardMetaRow}>
              {slots.bodyChips.map((chip) => (
                <Chip key={chip.key} chip={chip} />
              ))}
            </span>
          )}
        </div>
      )}

      {hasFooter && (
        <Strip left={slots.footerL} right={slots.footerR} className={styles.cardMetaRow} />
      )}

      {run && <CardRun run={run} overlay={overlay === true} />}
    </div>
  );
});

/** The header and the footer are the same shape: a left end and a right end. */
function Strip({
  left,
  right,
  className,
  children,
}: {
  left: CardChip[];
  right: CardChip[];
  className: string;
  /** What the card draws of its own, at the left end. The chain glyph. */
  children?: React.ReactNode;
}) {
  return (
    <div className={className}>
      {children}
      {left.map((chip) => (
        <Chip key={chip.key} chip={chip} />
      ))}
      {right.length > 0 && (
        <>
          <span style={{ flex: 1 }} />
          {right.map((chip) => (
            <Chip key={chip.key} chip={chip} />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * The strip of the board design: who is working, what it is doing, how long it
 * has been at it, and a bar that scans while it lives. The plan and the log
 * belong to the panel; a board full of runs has to stay readable. It is not a
 * row of the card view, because a run is not a field of a task.
 */
function CardRun({ run, overlay }: { run: AgentRunDTO; overlay: boolean }) {
  const now = useNow(isOpen(run.status));
  const life = lifeOf(run, now);
  const clock = runClock(run, now);

  return (
    <div className={styles.runStrip} data-testid="card-run" data-life={life}>
      <div className={styles.runStripRow}>
        <span className={styles.runAgent}>{run.agent.name}</span>
        <span className={styles.runText} data-testid="card-run-step">
          {overlay ? "Drop to take over" : runLine(run)}
        </span>
        <span
          className={`${styles.runTime} ${clock.stale ? styles.runTimeStale : ""}`}
          data-testid="card-run-time"
        >
          {clock.text}
        </span>
      </div>
      <span className={styles.runScan} aria-hidden>
        <span
          className={`${styles.runScanFill} ${runIsStill(run, now) ? styles.runScanPaused : ""}`}
        />
      </span>
    </div>
  );
}
