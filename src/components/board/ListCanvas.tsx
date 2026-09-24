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
import { canSort, pressSort, sortTasks, sortWayInline } from "@/lib/sort";
import type { TaskDTO } from "@/lib/types";
import { useCursorBack, useShortcut } from "./keys";
import { Composer } from "./Column";
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
    sort,
    viewSort,
    setSort,
    moveTask,
    createTask,
    togglePick,
    pickTo,
    runOf,
    controlRun,
    notify,
    user,
  } = useBoard();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [preview, setPreview] = useState<TaskDTO[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A list has one composer, at the end, so `n` has one place to open it.
  useShortcut("n", () => {
    if (!activeTaskId) setComposing(true);
  });

  const columns = useMemo(() => listColumns(cardItems), [cardItems]);
  const template = useMemo(() => listTemplate(columns), [columns]);

  /*
   * The rank every view shares, unless somebody asked a heading for another
   * order. A sort writes nothing, so the rank underneath is untouched and the
   * boards go on showing it.
   */
  const base = useMemo(
    () => sortTasks(sortByPosition(visibleTasks), sort, cardItems, data.members),
    [visibleTasks, sort, cardItems, data.members],
  );
  const rows = preview ?? base;

  /*
   * A drag writes a rank, and a sorted list is not showing ranks. Dropping a
   * row between two others would write an order nobody on this screen can see
   * and then leave the row where the sort puts it, which reads as the drag
   * having failed. So the rows are held still, and the chip above says why.
   */
  const sorted = sort !== null;

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

  /* `x` picks the row the cursor is on, and puts it back. It is the whole
     keyboard route into a pick: the checks are not tab stops, because the
     list has one, exactly as the board does. */
  useShortcut("x", () => {
    if (activeTaskId) return;
    if (cursorTaskId) togglePick(cursorTaskId);
  });

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
  const seed = seedValues(filters, data.properties, null, user.id);
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

  /*
   * Picking one row, and picking a run of them.
   *
   * A list is one column of rows, so the run is the whole list: the rows
   * between two of them on screen are the rows between them in the one order
   * the list is drawing. That is the difference from a board, where a run
   * across two columns is two runs. Shift is the only thing that means "and
   * the ones in between", so a plain press is always one row.
   */
  function pickRow(taskId: string, event: React.MouseEvent) {
    if (event.shiftKey)
      pickTo(
        taskId,
        rows.map((t) => t.id),
      );
    else togglePick(taskId);
  }

  useCursorBack(selectedTaskId, (taskId) => {
    const back = rows.some((t) => t.id === taskId) ? taskId : cursorTaskId;
    if (!back) return;
    setCursor(back);
    focusRow(scrollRef.current, back);
  });

  /* Focus and the cursor are the same thing, so a click or a Tab onto a row
     moves the cursor with it. */
  function onRowFocus(event: React.FocusEvent<HTMLDivElement>) {
    const id = rowIdOf(event.target);
    if (id) setCursor(id);
  }

  function onRowKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    // While a row is lifted the arrows belong to the drag sensor.
    if (activeTaskId) return;

    /* Space lifts a row, and a sorted list has no rank to lift one to. The
       sensor is off, so without this the press would fall through and scroll
       the list instead — which reads as the list having jumped by itself. */
    if (sorted && event.key === " " && rowIdOf(event.target)) {
      event.preventDefault();
      return;
    }

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
                const on = sort?.columnId === column.id ? sort.direction : null;
                /* The press writes my order, and mine falls back to the view's.
                   So the heading says what the screen will show after it, which
                   is not always the board's own order. */
                const next = pressSort(sort, viewSort, column.id);
                const after = next ?? viewSort;
                /* The words come from the one table the Sort button and the
                   chip read, so a heading never names an order another way. */
                const again =
                  after?.columnId === column.id
                    ? `Again for ${sortWayInline(column.item, after.direction)}.`
                    : after
                      ? "Again for this view's own order."
                      : "Again for the board's own order.";
                const said = on
                  ? `${column.name}, ${sortWayInline(column.item, on)}. ${again}`
                  : `Order by ${column.name}`;
                const className = [
                  styles.listHeadCell,
                  column.right ? styles.listHeadRight : "",
                  on ? styles.listHeadOn : "",
                  held.className,
                ]
                  .filter(Boolean)
                  .join(" ");

                if (!canSort(column.item)) {
                  return (
                    <span key={column.id} style={held.style} className={className}>
                      {column.name}
                    </span>
                  );
                }

                return (
                  <button
                    key={column.id}
                    type="button"
                    style={held.style}
                    className={className}
                    data-testid="list-head-cell"
                    /* `aria-sort` belongs to a columnheader, and nothing here
                       is one: the list is a grid that reads like a table, and
                       its rows are buttons. So the state goes in the name,
                       where it is read either way. */
                    aria-label={said}
                    /* Down, then up, then the third press takes my order
                       away, which is why it is on the heading and not hidden
                       in a menu. The list can be dragged again only when the
                       view has no order of its own; if it has one, the list
                       falls back to it and stays held. */
                    title={said}
                    onClick={() => void setSort(next)}
                  >
                    <span className={styles.listHeadWords} data-testid="list-head-name">
                      {column.name}
                    </span>
                    {on && (
                      <span className={styles.listHeadArrow} aria-hidden>
                        {on === "asc" ? "\u2191" : "\u2193"}
                      </span>
                    )}
                  </button>
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
                  frozen={sorted}
                  onOpen={() => onOpenTask(task)}
                  onPick={(event) => pickRow(task.id, event)}
                />
              ))}
            </SortableContext>

            {/* One composer, at the end. A column's top and bottom are two
                places; a list has one order and the drag is right there. */}
            {composing ? (
              <div className={styles.listCompose}>
                <Composer
                  ref={inputRef}
                  draft={draft}
                  setDraft={setDraft}
                  note={addNote}
                  commit={() => void commit()}
                  cancel={() => {
                    setDraft("");
                    setComposing(false);
                  }}
                />
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
  frozen,
  onOpen,
  onPick,
}: {
  task: TaskDTO;
  columns: ReturnType<typeof listColumns>;
  selected: boolean;
  cursor: boolean;
  /** A sorted list is not showing ranks, so there is no rank to drag one to. */
  frozen: boolean;
  onOpen: () => void;
  onPick: (event: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "row" },
    disabled: frozen,
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
      onPick={onPick}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined,
      }}
      dragProps={{ ...attributes, ...listeners }}
    />
  );
}
