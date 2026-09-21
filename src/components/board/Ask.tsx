"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PropertyDTO } from "@/lib/types";
import styles from "./board.module.css";

/**
 * A box above a list of rows, and the keys that walk them.
 *
 * Three controls ask the same question in the same shape: the filter's first
 * step, the whole of the sort panel, and **Set…** on the picked cards. So
 * they ask it with one box and one list, and a fix to the keys or to the aria
 * wiring reaches all three. What each one does with the answer is its own.
 *
 * It sits here rather than in `Filters.tsx` because the third caller is not a
 * filter: a module that everybody imports must not be somebody's own file.
 */

export type Row = { id: string; name: string; color: string; on?: boolean; note?: string };

/**
 * The rows are a listbox and the box keeps the focus, so the panel is one tab
 * stop like the board is. That is why the highlight is `aria-activedescendant`
 * and not focus, and why a row cannot be a button.
 */
export function Rows({
  rows,
  at,
  listId,
  empty,
  onPick,
}: {
  rows: Row[];
  at: number;
  listId: string;
  empty: string;
  onPick: (row: Row) => void;
}) {
  if (rows.length === 0) return <span className={styles.filterNote}>{empty}</span>;

  return (
    <div className={styles.filterList} role="listbox" id={listId}>
      {rows.map((row, i) => (
        <div
          key={row.id}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={!!row.on}
          className={`${styles.filterItem} ${row.on ? styles.filterItemOn : ""} ${
            i === at ? styles.filterItemAt : ""
          }`}
          // The box must keep the focus, so the press must not move it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(row)}
        >
          <span
            className={styles.dot6}
            style={{ background: row.color, opacity: row.on === false ? 0.45 : 1 }}
          />
          {row.name}
          <span style={{ flex: 1 }} />
          {row.note && <span className={styles.filterRowNote}>{row.note}</span>}
          {row.on !== undefined && (
            <span className={styles.filterTick} style={{ opacity: row.on ? 1 : 0 }}>
              ✓
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Where an arrow key takes the highlight. It wraps; a short list is a ring. */
export function step(at: number, count: number, way: number): number {
  if (count === 0) return 0;
  return (at + way + count) % count;
}

/**
 * The box itself.
 *
 * `Ask` in `Filters.tsx` keeps a box of its own, because it answers a question
 * instead of asking one: it carries an operator, a type, a blur that saves and
 * a Backspace that goes back.
 */
export function AskBox({
  query,
  onQuery,
  rows,
  at,
  setAt,
  onPick,
  listId,
  label,
  placeholder,
  testId,
}: {
  query: string;
  onQuery: (value: string) => void;
  rows: Row[];
  at: number;
  setAt: Dispatch<SetStateAction<number>>;
  onPick: (row: Row) => void;
  listId: string;
  label: string;
  placeholder: string;
  testId: string;
}) {
  return (
    <div className={styles.askHead}>
      <input
        className={styles.askBox}
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={rows.length ? `${listId}-${at}` : undefined}
        aria-label={label}
        data-testid={testId}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          onQuery(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            return setAt((n) => step(n, rows.length, 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            return setAt((n) => step(n, rows.length, -1));
          }
          if (e.key === "Enter" && rows[at]) {
            e.preventDefault();
            onPick(rows[at]);
          }
        }}
      />
    </div>
  );
}

/** The dot beside a property in the list. */
export function propertyColor(property: PropertyDTO): string {
  return property.options[0]?.color ?? "#4b8fbe";
}

/** The dot beside a row of the card that is not a property at all. */
export const BUILTIN_DOT = "#6b7280";
