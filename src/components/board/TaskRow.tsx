"use client";

import { forwardRef, useMemo } from "react";
import { buildRow } from "@/lib/card-view";
import type { ListColumn } from "@/lib/list-view";
import { isOpen, lifeOf, runClock, runIsStill, runLine } from "@/lib/run-state";
import type { AgentRunDTO, TaskDTO } from "@/lib/types";
import { useNow } from "@/components/ui/useElapsed";
import { Chip } from "./Chip";
import { useBoard } from "./store";
import styles from "./board.module.css";

type Props = {
  task: TaskDTO;
  columns: ListColumn[];
  selected?: boolean;
  /** This row carries the list cursor, so it is the list's tab stop. */
  cursor?: boolean;
  ghost?: boolean;
  overlay?: boolean;
  onOpen?: () => void;
  /** Picks this row, or puts it back. Absent on the drag overlay. */
  onPick?: (event: React.MouseEvent) => void;
  style?: React.CSSProperties;
  dragProps?: Record<string, unknown>;
};

/**
 * A row draws the card view and decides nothing, exactly as a card does.
 * Which columns there are, in what order and how they read all come from the
 * project's card view; this file only knows how to fill a cell.
 */
export const TaskRow = forwardRef<HTMLDivElement, Props>(function TaskRow(
  { task, columns, selected, cursor, ghost, overlay, onOpen, onPick, style, dragProps },
  ref,
) {
  const { cardItems, data, isPicked, picked, runOf } = useBoard();
  const run = runOf(task.id);

  /* The row wears the same border a card wears, and the check stays on the
     whole list while anything is picked, so the way out of a pick is where
     the way in was. */
  const mine = isPicked(task.id);
  const picking = picked.length > 0;

  const slots = useMemo(
    () => buildRow(cardItems, task, data.members),
    [cardItems, data.members, task],
  );

  const className = [
    styles.listRow,
    mine ? styles.listRowPicked : "",
    selected ? styles.listRowSelected : "",
    ghost ? styles.cardGhost : "",
    overlay ? styles.listRowOverlay : "",
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
      data-testid={overlay ? "list-row-overlay" : "list-row"}
      style={style}
      data-task-id={task.id}
      data-picked={mine ? "true" : undefined}
      /* A plain click still opens the task. Shift is what says "and this one
         too", so it never opens anything. */
      onClick={(event: React.MouseEvent) => {
        if (event.shiftKey && onPick) return onPick(event);
        onOpen?.();
      }}
      role="button"
      {...dragProps}
      /* dnd-kit hands every row a tab stop. The list keeps one, so Tab reaches
         the cursor in one press and the arrow keys do the walking. */
      tabIndex={cursor && !overlay ? 0 : -1}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        dragKeyDown?.(event);
        if (event.key === "Enter" && !event.defaultPrevented && onOpen) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {columns.map((column, at) => {
        const held = pinProps(columns, column, at);
        /* The colour the card wears, worn down the side of the line. It lives
           inside the first cell because that cell is the one held in place,
           and a stripe that scrolled away would leave the row unmarked. */
        const edge = at === 0 && slots.edge && (
          <span
            className={styles.listRowEdge}
            data-testid="list-row-edge"
            style={{ background: slots.edge }}
            aria-hidden
          />
        );

        /*
         * The check sits in the gutter the first cell already carries, before
         * the key. Not a column of its own: the columns of a list are the
         * rows of the card view and nothing else, and one that was never on a
         * card has no business being one. It lives inside the first cell
         * because that cell is the one held in place, so a list scrolled
         * sideways keeps its checks beside its keys.
         */
        const check = at === 0 && onPick && !overlay && (
          <button
            className={styles.listPick}
            data-testid="list-pick"
            data-on={picking ? "true" : undefined}
            aria-pressed={mine}
            aria-label={mine ? `Leave ${task.key} out` : `Pick ${task.key}`}
            /* The list has one tab stop, which is the row the cursor is on.
               Forty checks would give it forty-one. `x` is the keyboard way
               in, exactly as it is on the board. */
            tabIndex={-1}
            /* The row is the drag handle and this button sits on top of it. */
            onPointerDown={(event) => event.stopPropagation()}
            /* The press must not move the focus off the cursor row. */
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onPick(event);
            }}
          >
            <span aria-hidden>{mine ? "✓" : ""}</span>
          </button>
        );

        if (column.id === "_key") {
          return (
            <span key={column.id} {...held} className={`${styles.listKey} ${held.className}`}>
              {edge}
              {check}
              {task.key}
            </span>
          );
        }

        if (column.id === "_title") {
          return (
            <span key={column.id} {...held} className={`${styles.listTitle} ${held.className}`}>
              {edge}
              {check}
              <span className={styles.listTitleText} data-testid="list-row-title">
                {task.title}
              </span>
              {slots.desc && <span className={styles.listDesc}>{slots.desc}</span>}
              {run && <RowRun run={run} />}
            </span>
          );
        }

        return (
          <span
            key={column.id}
            className={`${styles.listChips} ${column.right ? styles.listChipsRight : ""}`}
            data-testid="list-cell"
          >
            {slots.cells[column.id]?.map((chip) => (
              <Chip key={chip.key} chip={chip} />
            ))}
          </span>
        );
      })}

      {run && <RunLine run={run} />}
    </div>
  );
});

/**
 * What a held cell needs to stay put: where it stops, and whether it is the
 * last of the held run and so carries the edge. The header draws its cells the
 * same way, which is why this is shared rather than written twice.
 */
export function pinProps(
  columns: ListColumn[],
  column: ListColumn,
  at: number,
): { className: string; style?: React.CSSProperties } {
  const lead = at === 0 ? styles.listCellLead : "";
  if (column.pin === null) return { className: lead };
  const last = columns[at + 1]?.pin === null || at === columns.length - 1;
  return {
    className: [styles.listPin, lead, last ? styles.listPinLast : ""].filter(Boolean).join(" "),
    style: { left: column.pin },
  };
}

/**
 * Who is working, and nothing else. A card gives a run its whole footer; a row
 * is one line, and a step that changes every few seconds on forty rows at once
 * is the exact noise the card refused. The whole line the card would have
 * shown is one hover away.
 */
function RowRun({ run }: { run: AgentRunDTO }) {
  const now = useNow(isOpen(run.status));
  const life = lifeOf(run, now);
  const word = runClock(run, now).text;

  return (
    <span
      className={styles.listRunAgent}
      data-testid="list-row-run"
      data-life={life}
      title={`${run.agent.name} · ${runLine(run)} · ${word}`}
    >
      {run.agent.name}
    </span>
  );
}

/**
 * The hairline the row already has, scanning while the run reports. It says
 * alive and says nothing else, which is all the room a line has. A paused or
 * silent run stops it, exactly as it stops the bar on a card.
 */
function RunLine({ run }: { run: AgentRunDTO }) {
  const now = useNow(isOpen(run.status));
  const still = runIsStill(run, now);

  return (
    <span className={styles.listRowRun} aria-hidden>
      <span className={`${styles.listRowRunFill} ${still ? styles.runScanPaused : ""}`} />
    </span>
  );
}
