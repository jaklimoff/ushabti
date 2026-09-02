"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import { cursorTarget, sortByPosition, type BoardColumn, type CursorStep } from "@/lib/board";
import { listColumns, listTemplate } from "@/lib/list-view";
import { seedNote, seedValues } from "@/lib/filters";
import type { TaskDTO } from "@/lib/types";
import { useBoard } from "./store";
import { TaskRow, pinProps } from "./TaskRow";
import styles from "./board.module.css";

const dropAnimation: DropAnimation = {
  duration: 210,
  easing: "cubic-bezier(0.18, 0.67, 0.28, 1)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.25" } },
  }),
};

/** The keys that move the cursor. Every other key is left alone. */
const STEPS: Record<string, CursorStep | undefined> = {
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "first",
  End: "last",
};

/** The task an event happened on, or null when it happened somewhere else. */
function rowIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>("[data-task-id]")?.dataset.taskId ?? null;
}

function focusRow(root: HTMLElement | null, taskId: string) {
  const row = root?.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * The list.
 *
 * A board draws the tasks of one property value in a column; a list draws all
 * of them in the one order every view already shares. That order is a task's
 * `position`, and until now no screen showed it — a board only ever draws a
 * subsequence of it, so nobody could see the order they were all sharing. This
 * is that screen, and its drag is the only place a task can be moved without
 * also changing a property.
 */
export function ListCanvas({
  selectedTaskId,
  onOpenTask,
}: {
  selectedTaskId: string | null;
  onOpenTask: (task: TaskDTO | null) => void;
}) {
  const {
    data,
    filters,
    visibleTasks,
    cardItems,
    moveTask,
    createTask,
    runOf,
    controlRun,
    notify,
  } = useBoard();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [preview, setPreview] = useState<TaskDTO[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const base = useMemo(() => sortByPosition(visibleTasks), [visibleTasks]);
  const rows = preview ?? base;

  const columns = useMemo(() => listColumns(cardItems), [cardItems]);
  const template = useMemo(() => listTemplate(columns), [columns]);

  /*
   * The cursor walks the same function the board walks, over a list that is one
   * column of rows. Up and down are the only steps that mean anything, and
   * `cursorTarget` already answers null for the other two, because its sideways
   * loop finds no second column. One walker, one set of rules.
   */
  const oneColumn = useMemo<BoardColumn[]>(
    () => [{ id: "list", name: "", color: "", value: null, isNone: false, tasks: rows }],
    [rows],
  );

  /* One row at a time carries the cursor, and that row is the list's only tab
     stop. A cursor whose task left the list falls back to the first row, so the
     list is never a dead end. */
  const cursorTaskId = useMemo(
    () => (cursor && rows.some((t) => t.id === cursor) ? cursor : (rows[0]?.id ?? null)),
    [cursor, rows],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Space picks a row up and puts it down. Enter is left alone so it can
    // still open the task.
    //
    // dnd-kit's own coordinate getter is right here, and the board's is not:
    // `liftedCardCoordinates` exists to beat a column that is as tall as the
    // board and loses every sum of corner distances. A single vertical list has
    // no such container. Do not unify the two.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  useEffect(() => {
    document.body.classList.toggle("ushabti-dragging", activeTaskId !== null);
    return () => document.body.classList.remove("ushabti-dragging");
  }, [activeTaskId]);

  useEffect(() => {
    if (composing) inputRef.current?.focus();
  }, [composing]);

  /*
   * A task the address bar names is one row among hundreds, and unlike a card
   * on a board it is the only place that task appears. Take it to it once.
   */
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedTaskId || scrolledTo.current === selectedTaskId) return;
    scrolledTo.current = selectedTaskId;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-task-id="${selectedTaskId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedTaskId]);

  /*
   * A list has no columns, so nothing else decides the grouping property and
   * the filter has to answer for it too. Without the null the row is written
   * and hidden in the same breath, with nothing on screen to say why.
   */
  const seed = seedValues(filters, data.properties, null);
  const addNote = seedNote(seed, data.properties, data.members);

  const activeTask = activeTaskId ? (data.tasks.find((t) => t.id === activeTaskId) ?? null) : null;

  function onDragStart(event: DragStartEvent) {
    setPreview([...base]);
    setActiveTaskId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const snapshot = preview;
    setActiveTaskId(null);
    setPreview(null);
    if (!over || !snapshot) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const from = snapshot.findIndex((t) => t.id === activeId);
    const to = snapshot.findIndex((t) => t.id === overId);
    if (from < 0 || to < 0 || from === to) return;

    const ordered = arrayMove(snapshot, from, to);
    const at = ordered.findIndex((t) => t.id === activeId);

    /*
     * The neighbours are named by id, never by index, so a filtered list ranks
     * the row beside the row a person can see and leaves the hidden tasks
     * between them where they are.
     */
    const beforeId = ordered[at + 1]?.id ?? null;
    const afterId = ordered[at - 1]?.id ?? null;

    // Moving a task an agent holds takes it over, the same as on the board. A
    // list that quietly reordered a held row would be the one place that leaks.
    const run = runOf(activeId);
    if (run) {
      const task = data.tasks.find((t) => t.id === activeId);
      notify(`You took ${task?.key ?? "the task"} over from ${run.agent.name}.`, "info");
      void controlRun(run.id, "take_over");
    }

    void moveTask({ taskId: activeId, beforeId, afterId });
  }

  async function commit() {
    const title = draft.trim();
    setDraft("");
    setComposing(false);
    if (!title) return;
    /* After the last row a person can see. The global bottom is somewhere else
       entirely once a filter is on. */
    const task = await createTask({
      title,
      values: seed,
      afterId: base.at(-1)?.id ?? null,
      atTop: false,
    });
    if (task) onOpenTask(task);
  }

  /* Focus and the cursor are the same thing, so a click or a Tab onto a row
     moves the cursor with it. */
  function onRowFocus(event: React.FocusEvent<HTMLDivElement>) {
    const id = rowIdOf(event.target);
    if (id) setCursor(id);
  }

  function onRowKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    // While a row is lifted the arrows belong to the drag sensor.
    if (activeTaskId) return;
    const step = STEPS[event.key];
    if (!step) return;
    // Keys typed in the composer are not ours. Left and right are nobody's:
    // a list has no sideways, and swallowing them would stop a wide one
    // scrolling.
    const from = rowIdOf(event.target);
    if (!from) return;

    event.preventDefault();
    const next = cursorTarget(oneColumn, from, step);
    if (!next || next === from) return;
    setCursor(next);
    focusRow(scrollRef.current, next);
  }

  return (
    <DndContext
      id="ushabti-list"
      sensors={sensors}
      // One vertical list of rows, all the same height. There is no tall empty
      // container here to lose a sum of corner distances to, which is the whole
      // reason the board cannot use this.
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveTaskId(null);
        setPreview(null);
      }}
      autoScroll={{ threshold: { x: 0.1, y: 0.2 }, acceleration: 14 }}
    >
      <div className={styles.list} data-testid="list-view">
        <div
          className={styles.listScroll}
          ref={scrollRef}
          onFocus={onRowFocus}
          onKeyDown={onRowKeys}
          style={{ "--list-cols": template } as React.CSSProperties}
        >
          <div className={styles.listGrid}>
            {/* Labels, not buttons. The order of a list is the rank everybody
                shares and drags to change; a header that sorted would show an
                order no drag can write and nobody else can see. */}
            <div className={styles.listHead} data-testid="list-head">
              {columns.map((column, at) => {
                const held = pinProps(columns, column, at);
                return (
                  <span
                    key={column.id}
                    style={held.style}
                    className={[
                      styles.listHeadCell,
                      column.right ? styles.listHeadRight : "",
                      held.className,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={column.name}
                  >
                    {column.name}
                  </span>
                );
              })}
            </div>

            <SortableContext items={rows.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {rows.map((task) => (
                <SortableRow
                  key={task.id}
                  task={task}
                  columns={columns}
                  selected={selectedTaskId === task.id}
                  cursor={cursorTaskId === task.id}
                  onOpen={() => onOpenTask(task)}
                />
              ))}
            </SortableContext>

            {/* One composer, at the end. A column's top and bottom are two
                places; a list has one order and the drag is right there. */}
            {composing ? (
              <div className={styles.listCompose}>
                <div className={styles.composer}>
                  <textarea
                    ref={inputRef}
                    className={styles.composerInput}
                    value={draft}
                    placeholder="What needs doing?"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void commit();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setDraft("");
                        setComposing(false);
                      }
                    }}
                    onBlur={() => {
                      if (draft.trim()) void commit();
                      else setComposing(false);
                    }}
                  />
                  <span className={styles.composerHint}>
                    Enter to add · {addNote || "Esc to cancel"}
                  </span>
                </div>
              </div>
            ) : (
              <button
                className={styles.listAdd}
                data-testid="list-add"
                aria-label="Add a task"
                onClick={() => {
                  setDraft("");
                  setComposing(true);
                }}
              >
                <span className={styles.listAddWords}>+ Add a task</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={dropAnimation} zIndex={300}>
        {activeTask && (
          <div style={{ ["--list-cols" as string]: template }}>
            <TaskRow task={activeTask} columns={columns} overlay />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function SortableRow({
  task,
  columns,
  selected,
  cursor,
  onOpen,
}: {
  task: TaskDTO;
  columns: ReturnType<typeof listColumns>;
  selected: boolean;
  cursor: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "row" },
    transition: { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });

  return (
    <TaskRow
      ref={setNodeRef}
      task={task}
      columns={columns}
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
