"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { elapsed } from "@/lib/run-state";
import type { Searchable } from "@/lib/search";
import { titleWithCount, waitingRows, type WaitingRow } from "@/lib/waiting";
import { useDismiss } from "@/components/ui/useDismiss";
import { useNow } from "@/components/ui/useElapsed";
import { step } from "./Ask";
import { useBoard } from "./store";
import styles from "./board.module.css";

/**
 * "N waiting" in the top bar, and the questions behind it.
 *
 * An ask used to show only on its own card, so a filter, a lens or a folded
 * column could keep it from everybody for hours. This reads the whole project,
 * as search does, and sits beside search for the same reason: it belongs to no
 * view. It is a live list, not an inbox — nothing is read or unread, and a row
 * goes on the read the answer rings for.
 *
 * The rows are drawn in the shape of search's hits rather than `Rows`, because
 * a row carries two lines: who asked and what.
 */
export function Waiting({ onAnswer }: { onAnswer: (task: Searchable) => void }) {
  const { data, visibleTasks } = useBoard();
  const [open, setOpen] = useState(false);
  /* The highlight is a task, not a place: the list is live, and a row that
     goes must not slide the next question under it. The place is kept only
     to land near it when the highlighted task itself goes. */
  const [at, setAt] = useState<{ id: string | null; index: number }>({ id: null, index: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => new Set(visibleTasks.map((t) => t.id)), [visibleTasks]);
  const rows = useMemo(
    () => waitingRows(data.tasks, data.runs, shown),
    [data.runs, data.tasks, shown],
  );
  const count = rows.length;
  /* The clock runs while something waits, so the list opens on the right
     number rather than the one from when the button was first drawn. */
  const now = useNow(count > 0);

  /* A tab in the background shows the count in its title. The page's own
     title is whatever Next wrote; only the "(N) " in front is ours. */
  useEffect(() => {
    document.title = titleWithCount(document.title, count);
  }, [count]);
  useEffect(() => () => void (document.title = titleWithCount(document.title, 0)), []);

  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(close, open);

  /* The list takes the focus when it opens, so the arrows walk it at once. */
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  /* The last question was answered while the list was open. */
  if (open && count === 0) setOpen(false);
  if (count === 0) return null;

  const found = rows.findIndex((row) => row.task.id === at.id);
  const highlighted = found >= 0 ? found : Math.min(at.index, count - 1);
  const highlight = (index: number) => setAt({ id: rows[index].task.id, index });

  function pick(row: WaitingRow) {
    setOpen(false);
    onAnswer(row.task);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      highlight(step(highlighted, count, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      highlight(event.key === "Home" ? 0 : count - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(rows[highlighted]);
      return;
    }
    if (event.key === "Escape") {
      /* The focus goes back where it came from, so Escape is not a dead end. */
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div className={styles.waitAnchor} ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.waitButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? "board-waiting" : undefined}
        data-testid="waiting-count"
        title="Tasks where an agent asked a question"
        onClick={() => {
          setAt({ id: null, index: 0 });
          setOpen((was) => !was);
        }}
      >
        <span className={styles.waitDot} aria-hidden />
        {count} waiting
      </button>

      {open && (
        <div className={`${styles.popover} ${styles.searchPop} ${styles.waitPop}`}>
          <div
            ref={listRef}
            className={`${styles.searchList} ${styles.waitList}`}
            role="listbox"
            id="board-waiting"
            tabIndex={-1}
            aria-label="Tasks where an agent asked a question"
            aria-activedescendant={`board-waiting-${highlighted}`}
            data-testid="waiting-list"
            onKeyDown={onKeyDown}
          >
            {rows.map((row, i) => (
              <div
                key={row.task.id}
                id={`board-waiting-${i}`}
                role="option"
                aria-selected={i === highlighted}
                data-testid="waiting-row"
                className={`${styles.searchItem} ${i === highlighted ? styles.searchItemAt : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(row)}
              >
                <span className={styles.searchLine}>
                  <span className={styles.searchKey}>{row.task.key}</span>
                  <span className={styles.searchTitle}>{row.task.title}</span>
                  {row.note && (
                    <span className={styles.searchAway} title="A filter on this view hides it">
                      {row.note}
                    </span>
                  )}
                </span>
                <span className={styles.waitAsk}>
                  <span className={styles.waitWho}>{row.run.agent.name}</span>
                  <span className={styles.waitQuestion}>{row.question}</span>
                  <span className={styles.waitSince}>{elapsed(row.run.updatedAt, now)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
