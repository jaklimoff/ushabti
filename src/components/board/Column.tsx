"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import type { BoardColumn } from "@/lib/board";
import type { TaskDTO } from "@/lib/types";
import { TaskCard } from "./TaskCard";
import styles from "./board.module.css";

export const COLUMN_PREFIX = "column:";
export const CONTAINER_PREFIX = "container:";

function SortableTask({
  task,
  columnId,
  selected,
  cursor,
  onOpen,
}: {
  task: TaskDTO;
  columnId: string;
  selected: boolean;
  cursor: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "card", columnId },
    transition: { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });

  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      selected={selected}
      cursor={cursor}
      ghost={isDragging}
      onOpen={onOpen}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined,
      }}
      dragProps={{ ...attributes, ...listeners }}
    />
  );
}

export type ComposerPlace = "top" | "bottom";

export function Column({
  column,
  selectedTaskId,
  cursorTaskId,
  draggable,
  addNote,
  composing,
  onCompose,
  onOpenTask,
  onAddTask,
  onFold,
}: {
  column: BoardColumn;
  selectedTaskId: string | null;
  cursorTaskId: string | null;
  draggable: boolean;
  /** What the filter will put on the new task, or "" when it puts nothing. */
  addNote: string;
  /** Where the composer is open in this column, if it is. The board holds it,
      so that a key pressed on the board can open it too. */
  composing: ComposerPlace | null;
  onCompose: (place: ComposerPlace | null) => void;
  onOpenTask: (task: TaskDTO) => void;
  onAddTask: (column: BoardColumn, title: string, atTop: boolean) => void;
  /** Folds this column to a strip, or opens it again. This browser only. */
  onFold: (folded: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sortable = useSortable({
    id: COLUMN_PREFIX + column.id,
    data: { type: "column", columnId: column.id },
    disabled: !draggable,
  });

  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: CONTAINER_PREFIX + column.id,
    data: { type: "container", columnId: column.id },
  });

  useEffect(() => {
    if (composing) inputRef.current?.focus();
  }, [composing]);

  function commit() {
    const title = draft.trim();
    if (title) onAddTask(column, title, composing === "top");
    setDraft("");
    onCompose(null);
  }

  const className = [
    styles.column,
    column.folded ? styles.columnFolded : "",
    column.isNone ? styles.columnNone : "",
    isOver ? styles.columnOver : "",
    sortable.isDragging ? styles.columnDragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  const place = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition ?? undefined,
  };

  /*
   * The strip is the header stood on its end, and the whole of it is the
   * button that opens the column again. It carries the drop target, so a card
   * dragged onto it still lands at the end of the column and nothing is lost.
   *
   * There is no grip here on purpose. A grip inside a button is two answers to
   * one press, and the column order belongs to the option everybody shares
   * while a fold belongs to this browser. Open the column to move it.
   */
  if (column.folded) {
    return (
      <div ref={sortable.setNodeRef} className={className} data-testid="column" style={place}>
        <button
          ref={setDropRef}
          className={styles.strip}
          data-testid="column-strip"
          title="Open this column"
          aria-label={`Open the column ${column.name}`}
          onClick={() => onFold(false)}
        >
          <span
            className={styles.colDot}
            style={{ background: column.color, boxShadow: `0 0 0 3px ${column.color}18` }}
          />
          <span className={styles.colCount} data-testid="column-count">
            {column.tasks.length}
          </span>
          <span className={styles.stripName} data-testid="column-name">
            {column.name}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div ref={sortable.setNodeRef} className={className} data-testid="column" style={place}>
      <div className={styles.colHead}>
        {draggable ? (
          <span
            className={styles.grip}
            title="Drag to reorder the column"
            {...sortable.attributes}
            {...sortable.listeners}
            aria-label={`Reorder the column ${column.name}`}
          >
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        ) : (
          <span style={{ width: 10 }} />
        )}
        <span className={styles.colTitle}>
          <span
            className={styles.colDot}
            style={{ background: column.color, boxShadow: `0 0 0 3px ${column.color}18` }}
          />
          <span className={styles.colName} data-testid="column-name">
            {column.name}
          </span>
        </span>
        <span className={styles.colCount} data-testid="column-count">
          {column.tasks.length}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className={styles.colAdd}
          aria-label={`Add a task to the top of ${column.name}`}
          title="Add a task to the top of this column"
          onClick={() => {
            onCompose("top");
            setDraft("");
          }}
        >
          +
        </button>
        <button
          className={`${styles.colAdd} ${styles.colFold}`}
          aria-label={`Fold the column ${column.name}`}
          title="Fold this column to a strip"
          onClick={() => onFold(true)}
        >
          «
        </button>
      </div>

      <div className={styles.colBody} ref={setDropRef} data-testid="column-body">
        {composing === "top" && (
          <Composer
            ref={inputRef}
            draft={draft}
            setDraft={setDraft}
            note={addNote}
            commit={commit}
            cancel={() => onCompose(null)}
          />
        )}

        <SortableContext
          items={column.tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {column.tasks.map((task) => (
            <SortableTask
              key={task.id}
              task={task}
              columnId={column.id}
              selected={selectedTaskId === task.id}
              cursor={cursorTaskId === task.id}
              onOpen={() => onOpenTask(task)}
            />
          ))}
        </SortableContext>

        {composing === "bottom" && (
          <Composer
            ref={inputRef}
            draft={draft}
            setDraft={setDraft}
            note={addNote}
            commit={commit}
            cancel={() => onCompose(null)}
          />
        )}

        {composing === null && (
          <button
            className={styles.emptyDrop}
            onClick={() => {
              onCompose("bottom");
              setDraft("");
            }}
            title="Add a task"
            aria-label={`Add a task to ${column.name}`}
          >
            {column.tasks.length === 0 ? "Add a task" : ""}
          </button>
        )}
      </div>
    </div>
  );
}

const Composer = function Composer({
  ref,
  draft,
  setDraft,
  note,
  commit,
  cancel,
}: {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  note: string;
  commit: () => void;
  cancel: () => void;
}) {
  return (
    <div className={styles.composer}>
      <textarea
        ref={ref}
        className={styles.composerInput}
        value={draft}
        placeholder="What needs doing?"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => (draft.trim() ? commit() : cancel())}
      />
      {/* A filtered board says what it is about to write, so the card it
          makes is never a surprise and never disappears. */}
      <span className={styles.composerHint}>Enter to add · {note || "Esc to cancel"}</span>
    </div>
  );
};
