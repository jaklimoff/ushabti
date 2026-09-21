"use client";

import type { BoardColumn } from "@/lib/board";
import styles from "./board.module.css";

/**
 * Which column a phone is on, and the way to another one.
 *
 * It is not a second view strip. It names columns rather than views, it is
 * drawn only where a board cannot draw them side by side, it carries no sort,
 * no filter and no count of its own, and its pills never drag — the column
 * order belongs to the property everybody shares, and a drop here could only
 * name the pill it landed after.
 *
 * A pill says the same three things a column header says: the colour, the
 * name, and how many cards are in it. The one on screen is filled.
 */
export function ColumnStrip({
  columns,
  shownId,
  onShow,
  children,
}: {
  columns: BoardColumn[];
  shownId: string | null;
  onShow: (columnId: string) => void;
  /** The way to a new column, which is a pill at the end of the strip. */
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.columnStrip} data-testid="column-strip-row">
      <div className={styles.columnPills} role="group" aria-label="The columns of this board">
        {columns.map((column) => {
          const on = column.id === shownId;
          return (
            <button
              key={column.id}
              className={`${styles.columnPill} ${on ? styles.columnPillOn : ""}`}
              data-testid="column-pill"
              aria-pressed={on}
              aria-label={`Show the column ${column.name}`}
              onClick={() => onShow(column.id)}
            >
              <span className={styles.pillDot} style={{ background: column.color }} />
              <span className={styles.columnPillName} data-testid="column-pill-name">
                {column.name}
              </span>
              <span className={styles.colCount} data-testid="column-pill-count">
                {column.tasks.length}
              </span>
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
