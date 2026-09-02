"use client";

import { forwardRef, useMemo } from "react";
import type { AgentRunDTO, TaskDTO } from "@/lib/types";
import { buildCard, type CardChip } from "@/lib/card-view";
import { elapsed, isOpen, lifeOf, LIFE_WORD, runLine } from "@/lib/run-state";
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
  style?: React.CSSProperties;
  dragProps?: Record<string, unknown>;
};

/**
 * A card draws what the card view asks for and nothing else. Which rows those
 * are, where they sit and how they read all live in the project's card view,
 * which the settings page arranges; this file only knows how to draw a chip.
 */
export const TaskCard = forwardRef<HTMLDivElement, Props>(function TaskCard(
  { task, selected, cursor, ghost, overlay, onOpen, style, dragProps },
  ref,
) {
  const { cardItems, data, runOf } = useBoard();
  const run = runOf(task.id);

  const slots = useMemo(
    () => buildCard(cardItems, task, data.members),
    [cardItems, data.members, task],
  );

  const hasHeader = slots.headerL.length > 0 || slots.headerR.length > 0;
  const hasBody = slots.body !== null || slots.bodyChips.length > 0;
  const hasFooter = slots.footerL.length > 0 || slots.footerR.length > 0;

  const className = [
    styles.card,
    slots.edge ? styles.cardEdged : "",
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
      onClick={onOpen}
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
      {slots.edge && (
        <span
          className={styles.cardEdge}
          data-testid="card-edge"
          style={{ background: slots.edge }}
          aria-hidden
        />
      )}

      {hasHeader && <Strip left={slots.headerL} right={slots.headerR} className={styles.cardTop} />}

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
}: {
  left: CardChip[];
  right: CardChip[];
  className: string;
}) {
  return (
    <div className={className}>
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
  const paused = run.status === "paused";

  // A run that answers shows how long it has worked. One that has gone quiet
  // shows how long ago it last said anything, because that is the number a
  // person needs, and the strip has room for one.
  const since = elapsed(life === "reporting" ? run.startedAt : run.updatedAt, now);

  return (
    <div className={styles.runStrip} data-testid="card-run" data-life={life}>
      <div className={styles.runStripRow}>
        <span className={styles.runAgent}>{run.agent.name}</span>
        <span className={styles.runText} data-testid="card-run-step">
          {overlay ? "Drop to take over" : runLine(run)}
        </span>
        <span
          className={`${styles.runTime} ${life === "reporting" ? "" : styles.runTimeStale}`}
          data-testid="card-run-time"
        >
          {life === "reporting" ? since : `${LIFE_WORD[life]} ${since}`}
        </span>
      </div>
      <span className={styles.runScan} aria-hidden>
        <span
          className={`${styles.runScanFill} ${paused || life === "silent" ? styles.runScanPaused : ""}`}
        />
      </span>
    </div>
  );
}
