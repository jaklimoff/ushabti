"use client";

import { useEffect, useMemo, useRef } from "react";
import { formatDate, sortByPosition } from "@/lib/board";
import { optionTasks } from "@/lib/roadmap";
import { sortTasks } from "@/lib/sort";
import { isTyping } from "./keys";
import { Markdown, type TaskKeyLinks } from "./Markdown";
import { endOf, useRoadmap } from "./RoadmapCanvas";
import { useBoard } from "./store";
import boardStyles from "./board.module.css";
import styles from "./panel.module.css";

type Openable = { id: string; key: string };

/**
 * What one bar of a roadmap holds, in the panel a task opens in.
 *
 * It reads and writes nothing of its own. The dates and the note are edited
 * in Settings, and a task moves between options on a board, so the only
 * thing to do here is open a task. The live tasks are the ones the bar fills
 * from: the view's filters, in the order the board draws them. A task opened
 * from here takes the panel's place, and closing it brings this list back.
 */
export function RoadmapPanel({
  optionId,
  backTo,
  onClose,
  onGone,
  onOpenTask,
}: {
  optionId: string;
  /** The task this list opened last, so the focus comes back to its row. */
  backTo: string | null;
  onClose: () => void;
  /** The row went, under a filter: the panel goes for good, not until it is back. */
  onGone: () => void;
  onOpenTask: (task: Openable) => void;
}) {
  const { data, visibleTasks, groupProperty, sort, cardItems } = useBoard();
  const { drawn } = useRoadmap();
  const panelRef = useRef<HTMLElement>(null);

  /* A filter can take the row away while the panel is open, and then the
     panel goes with it, as a column's cards go with the column. */
  const row = drawn.find((r) => r.id === optionId) ?? null;
  const option = groupProperty?.options.find((o) => o.id === optionId) ?? null;

  const ordered = useMemo(
    () => sortTasks(sortByPosition(visibleTasks), sort, cardItems, data.members),
    [visibleTasks, sort, cardItems, data.members],
  );
  const tasks = useMemo(
    () =>
      groupProperty
        ? optionTasks(
            groupProperty.id,
            optionId,
            ordered,
            data.archived,
            data.archivedUnder[optionId],
          )
        : { live: [], archived: [] },
    [groupProperty, optionId, ordered, data.archived, data.archivedUnder],
  );

  const links = useMemo<TaskKeyLinks>(
    () => ({
      projectId: data.project.id,
      projectKey: data.project.key,
      tasks: [...data.tasks, ...data.archived],
      open: onOpenTask,
    }),
    [data.project.id, data.project.key, data.tasks, data.archived, onOpenTask],
  );

  const shown = row !== null && option !== null;

  /* Otherwise the panel would come back by itself when the filter goes, and
     take the focus from wherever the person had moved on to. */
  useEffect(() => {
    if (!shown) onGone();
  }, [shown, onGone]);

  useEffect(() => {
    if (!shown) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !isTyping(event.target)) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, onClose]);

  /* The focus comes into the panel when it opens, so the keys reach the rows
     at once; back from a task, it lands on that task's row. */
  useEffect(() => {
    if (!shown) return;
    const panel = panelRef.current;
    const back = backTo
      ? panel?.querySelector<HTMLElement>(`[data-task="${CSS.escape(backTo)}"]`)
      : null;
    (back ?? panel)?.focus();
    // Once per option: a board read must not pull the focus back here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, optionId]);

  if (!row || !option) return null;

  const count = tasks.live.length + tasks.archived.length;

  return (
    <aside
      className={styles.panel}
      data-testid="roadmap-panel"
      ref={panelRef}
      tabIndex={-1}
      aria-label={option.name}
    >
      <div className={styles.accent} style={{ background: option.color }} />
      <div className={styles.head}>
        <div className={styles.headRow}>
          <span className={styles.optionDates} data-testid="roadmap-panel-dates">
            {formatDate(row.start)} – {endOf(row)}
          </span>
          <span style={{ flex: 1 }} />
          <button
            className={styles.iconButton}
            aria-label={`Close ${option.name}`}
            title="Close (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <h2 className={styles.optionName}>{option.name}</h2>
        {option.note?.trim() && (
          <div className={styles.optionNote} data-testid="roadmap-panel-note">
            <Markdown text={option.note} links={links} />
          </div>
        )}
      </div>

      <div className={styles.body}>
        {count === 0 ? (
          <p className={styles.optionEmpty}>No task is under {option.name}.</p>
        ) : (
          <ul className={styles.optionTasks} aria-label={`Tasks under ${option.name}`}>
            {/* Archived last: a ship archived them, so they are what is over. */}
            {[...tasks.live, ...tasks.archived].map((task) => {
              const archived = "archivedAt" in task && task.archivedAt !== null;
              return (
                <li key={task.id}>
                  {/* The row a search hit and a waiting question are drawn
                      in, so a task reads one way in every list of tasks. */}
                  <button
                    type="button"
                    className={`${boardStyles.searchItem} ${styles.optionTask}`}
                    data-testid="roadmap-panel-task"
                    data-task={task.id}
                    data-archived={archived || undefined}
                    onClick={() => onOpenTask(task)}
                  >
                    <span className={boardStyles.searchLine}>
                      <span className={boardStyles.searchKey}>{task.key}</span>
                      <span className={boardStyles.searchTitle}>{task.title}</span>
                      {archived && <span className={boardStyles.searchAway}>Archived</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
