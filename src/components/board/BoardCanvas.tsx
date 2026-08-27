"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  closestCorners,
  defaultDropAnimationSideEffects,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type ClientRect,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildColumns,
  cursorTarget,
  firstTask,
  sortByPosition,
  type BoardColumn,
  type CursorStep,
} from "@/lib/board";
import { allowedColumns, seedNote, seedValues } from "@/lib/filters";
import type { TaskDTO, TaskValue } from "@/lib/types";
import { useBoard } from "./store";
import { COLUMN_PREFIX, CONTAINER_PREFIX, Column } from "./Column";
import { TaskCard } from "./TaskCard";
import styles from "./board.module.css";

const dropAnimation: DropAnimation = {
  duration: 210,
  easing: "cubic-bezier(0.18, 0.67, 0.28, 1)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.25" } },
  }),
};

/** Columns and cards live in one context, so each kind gets its own targets. */
const collision: CollisionDetection = (args) => {
  const isColumn = args.active.data.current?.type === "column";
  const containers = args.droppableContainers.filter((c) =>
    isColumn ? c.data.current?.type === "column" : c.data.current?.type !== "column",
  );
  const scoped = { ...args, droppableContainers: containers };
  if (isColumn) return closestCenter(scoped);

  // A card follows the pointer, so the target under the pointer is the one the
  // person means. Distance alone is not enough: an empty column is as tall as
  // the board, which puts two of its corners hundreds of pixels away, so
  // closestCorners always preferred a small card in the column next door and
  // an empty column could never be dropped into.
  const under = pointerWithin(scoped);
  if (under.length) return under;

  // The keyboard sensor moves a card with no pointer at all, so it needs
  // geometry. Overlap is the right measure: a card the dragged card sits on
  // top of covers most of it, while the tall column behind covers little, so
  // the card wins where there is one and the column wins where there is not.
  const overlapping = rectIntersection(scoped);
  if (overlapping.length) return overlapping;

  // Nothing overlaps at all, which happens in the gaps between the columns.
  return closestCorners(scoped);
};

/**
 * Where an arrow key takes a lifted card. Sideways it goes to the column beside
 * it, whether or not that column holds any cards.
 *
 * dnd-kit's own getter scores every target by its four corners, and an empty
 * column is as tall as the board, so its two bottom corners are hundreds of
 * pixels away. A small card one column further over won every time and a lifted
 * card jumped straight over the gap it was aimed at — the same reckoning the
 * collision above had to stop trusting, for the same reason.
 *
 * Up and down stay with dnd-kit: inside one column its answer is right.
 */
const liftedCardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const way = event.code === "ArrowLeft" ? -1 : event.code === "ArrowRight" ? 1 : 0;
  if (!way) return sortableKeyboardCoordinates(event, args);

  const { collisionRect, droppableContainers, droppableRects } = args.context;
  if (!collisionRect) return undefined;
  event.preventDefault();

  // The column next door is the nearest one that clears the card altogether.
  // Its own column never does, which is what keeps the card moving.
  let column: { id: string; rect: ClientRect } | null = null;
  const cards: { columnId: string; rect: ClientRect }[] = [];

  for (const entry of droppableContainers.getEnabled()) {
    const data = entry.data.current;
    const rect = droppableRects.get(entry.id);
    if (!data || !rect) continue;

    if (data.type === "card") {
      cards.push({ columnId: String(data.columnId), rect });
      continue;
    }
    if (data.type !== "container") continue;

    const beside = way > 0 ? rect.left >= collisionRect.right : rect.right <= collisionRect.left;
    const nearer =
      !column || (way > 0 ? rect.left < column.rect.left : rect.right > column.rect.right);
    if (beside && nearer) column = { id: String(data.columnId), rect };
  }

  if (!column) return undefined;

  // Inside that column the card keeps the height it was at. An empty column has
  // no card to keep it beside, so the column itself is the target.
  const middle = collisionRect.top + collisionRect.height / 2;
  let target = column.rect;
  let nearest = Number.POSITIVE_INFINITY;
  for (const card of cards) {
    if (card.columnId !== column.id) continue;
    const gap = Math.abs(card.rect.top + card.rect.height / 2 - middle);
    if (gap < nearest) {
      nearest = gap;
      target = card.rect;
    }
  }

  return { x: target.left, y: target.top };
};

function findColumn(columns: BoardColumn[], taskId: string) {
  return columns.find((c) => c.tasks.some((t) => t.id === taskId)) ?? null;
}

function columnOf(columns: BoardColumn[], overId: string) {
  if (overId.startsWith(CONTAINER_PREFIX)) {
    const id = overId.slice(CONTAINER_PREFIX.length);
    return columns.find((c) => c.id === id) ?? null;
  }
  if (overId.startsWith(COLUMN_PREFIX)) {
    const id = overId.slice(COLUMN_PREFIX.length);
    return columns.find((c) => c.id === id) ?? null;
  }
  return findColumn(columns, overId);
}

/** The keys that move the cursor. Every other key is left alone. */
const STEPS: Record<string, CursorStep | undefined> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "first",
  End: "last",
};

/** The task an event happened on, or null when it happened somewhere else. */
function cardIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>("[data-task-id]")?.dataset.taskId ?? null;
}

/**
 * The cursor is the focused card, so moving the cursor moves focus. The card is
 * already drawn, so it is found in the page rather than held in a ref map. The
 * scroll is asked for by hand, because focus on its own scrolls a column more
 * than it has to and never scrolls the board sideways.
 */
function focusCard(root: HTMLElement | null, taskId: string) {
  const card = root?.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
  if (!card) return;
  card.focus({ preventScroll: true });
  card.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function BoardCanvas({
  selectedTaskId,
  onOpenTask,
}: {
  selectedTaskId: string | null;
  onOpenTask: (task: TaskDTO | null) => void;
}) {
  const {
    data,
    groupProperty,
    filters,
    visibleTasks,
    moveTask,
    createTask,
    patchOption,
    runOf,
    controlRun,
    notify,
  } = useBoard();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [preview, setPreview] = useState<BoardColumn[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The filters of the view are already off `visibleTasks`, so every part of
  // the board below this line — the columns, the drag preview, the cursor —
  // sees the same board a person sees.
  const base = useMemo(
    () =>
      allowedColumns(
        buildColumns(groupProperty, sortByPosition(visibleTasks), data.members),
        filters,
        groupProperty,
      ),
    [visibleTasks, data.members, filters, groupProperty],
  );

  const columns = preview ?? base;

  /*
   * A column may not be dragged while a rule hides some of its neighbours. The
   * order belongs to the property, not to this view, and a drop can only name
   * the column it landed after — so through a filter it would rank the option
   * after a column somebody else cannot see, and move it on their board too.
   * You cannot reorder a list you are only being shown part of.
   */
  const partial = !!groupProperty && filters.rules.some((r) => r.propertyId === groupProperty.id);
  const columnsDraggable = groupProperty?.type === "select" && !partial;

  /* One card at a time carries the cursor, and that card is the board's only
     tab stop: Tab reaches the board once instead of once for every card, and
     the arrows do the walking. A cursor whose card left the board falls back to
     the first card, so the board is never a dead end. */
  const cursorTaskId = useMemo(
    () =>
      cursor && columns.some((c) => c.tasks.some((t) => t.id === cursor))
        ? cursor
        : firstTask(columns),
    [columns, cursor],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Space picks a card up and puts it down. Enter is left alone so it can
    // still open the task.
    useSensor(KeyboardSensor, {
      coordinateGetter: liftedCardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  useEffect(() => {
    const dragging = activeTaskId !== null || activeColumnId !== null;
    document.body.classList.toggle("ushabti-dragging", dragging);
    return () => document.body.classList.remove("ushabti-dragging");
  }, [activeTaskId, activeColumnId]);

  const addNote = seedNote(
    seedValues(filters, data.properties, groupProperty?.id ?? null),
    data.properties,
    data.members,
  );

  const activeTask = activeTaskId ? (data.tasks.find((t) => t.id === activeTaskId) ?? null) : null;
  const activeColumn = activeColumnId
    ? (columns.find((c) => c.id === activeColumnId) ?? null)
    : null;

  function onDragStart(event: DragStartEvent) {
    const type = event.active.data.current?.type;
    setPreview(base.map((c) => ({ ...c, tasks: [...c.tasks] })));
    if (type === "column") setActiveColumnId(String(event.active.data.current?.columnId));
    else setActiveTaskId(String(event.active.id));
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.data.current?.type === "column") return;

    const activeId = String(active.id);
    const overId = String(over.id);

    setPreview((current) => {
      if (!current) return current;
      const from = findColumn(current, activeId);
      const to = columnOf(current, overId);
      if (!from || !to || from.id === to.id) return current;

      const task = from.tasks.find((t) => t.id === activeId);
      if (!task) return current;

      const overIndex = to.tasks.findIndex((t) => t.id === overId);
      let insertAt = to.tasks.length;
      if (overIndex >= 0) {
        const rect = active.rect.current.translated;
        const below = rect ? rect.top > over.rect.top + over.rect.height / 2 : false;
        insertAt = overIndex + (below ? 1 : 0);
      }

      return current.map((column) => {
        if (column.id === from.id) {
          return { ...column, tasks: column.tasks.filter((t) => t.id !== activeId) };
        }
        if (column.id === to.id) {
          const next = column.tasks.filter((t) => t.id !== activeId);
          next.splice(Math.min(insertAt, next.length), 0, task);
          return { ...column, tasks: next };
        }
        return column;
      });
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const snapshot = preview;
    setActiveTaskId(null);
    setActiveColumnId(null);

    if (!over || !snapshot) {
      setPreview(null);
      return;
    }

    /* ---- column reorder ------------------------------------------- */
    if (active.data.current?.type === "column") {
      const fromId = String(active.data.current.columnId);
      const toId = String(over.data.current?.columnId ?? "");
      const fromIndex = snapshot.findIndex((c) => c.id === fromId);
      const toIndex = snapshot.findIndex((c) => c.id === toId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        setPreview(null);
        return;
      }
      const ordered = arrayMove(snapshot, fromIndex, toIndex);
      const at = ordered.findIndex((c) => c.id === fromId);
      let afterId: string | null = null;
      for (let i = at - 1; i >= 0; i -= 1) {
        if (!ordered[i].isNone) {
          afterId = ordered[i].id;
          break;
        }
      }
      setPreview(ordered);
      void patchOption(fromId, { afterId }).finally(() => setPreview(null));
      return;
    }

    /* ---- card move -------------------------------------------------- */
    const activeId = String(active.id);
    const overId = String(over.id);
    const target = findColumn(snapshot, activeId);
    if (!target) {
      setPreview(null);
      return;
    }

    let ordered = target.tasks;
    if (overId.startsWith(CONTAINER_PREFIX)) {
      // Dropped on the free space under the cards. If the card comes from
      // another column it is already last, but a card from this same column
      // has not moved yet, so send it to the end.
      const from = ordered.findIndex((t) => t.id === activeId);
      if (from >= 0 && from !== ordered.length - 1) {
        ordered = arrayMove(ordered, from, ordered.length - 1);
      }
    } else if (overId !== activeId) {
      const from = ordered.findIndex((t) => t.id === activeId);
      const to = ordered.findIndex((t) => t.id === overId);
      if (from >= 0 && to >= 0) ordered = arrayMove(ordered, from, to);
    }

    const index = ordered.findIndex((t) => t.id === activeId);
    const beforeId = ordered[index + 1]?.id ?? null;
    const afterId = ordered[index - 1]?.id ?? null;

    const task = data.tasks.find((t) => t.id === activeId);
    const values: Record<string, TaskValue> = {};
    if (groupProperty && task) {
      const current = task.values[groupProperty.id] ?? null;
      const wanted = target.value;
      const same =
        groupProperty.type === "checkbox"
          ? (current === true) === (wanted === true)
          : (current ?? null) === (wanted ?? null);
      if (!same) values[groupProperty.id] = wanted;
    }

    const unchanged =
      Object.keys(values).length === 0 &&
      base.find((c) => c.id === target.id)?.tasks.findIndex((t) => t.id === activeId) === index;

    setPreview(null);
    if (unchanged) return;

    // Moving a card an agent holds takes it over. The run ends, the agent
    // reads that on its next report, and the person owns the card again.
    const run = runOf(activeId);
    if (run) {
      notify(`You took ${task?.key ?? "the task"} over from ${run.agent.name}.`, "info");
      void controlRun(run.id, "take_over");
    }

    void moveTask({ taskId: activeId, beforeId, afterId, values });
  }

  async function addTask(column: BoardColumn, title: string, atTop: boolean) {
    // The filter decides everything the column does not, so a task added to a
    // filtered board is not hidden by the filter it was added under.
    const values: Record<string, TaskValue> = seedValues(
      filters,
      data.properties,
      groupProperty?.id ?? null,
    );
    if (groupProperty && !column.isNone) values[groupProperty.id] = column.value;
    const neighbour = atTop ? null : (column.tasks.at(-1)?.id ?? null);
    const task = await createTask({ title, values, afterId: neighbour, atTop });
    if (task) onOpenTask(task);
  }

  /* Focus and the cursor are the same thing, so a click or a Tab onto a card
     moves the cursor with it. */
  function onCardFocus(event: React.FocusEvent<HTMLDivElement>) {
    const id = cardIdOf(event.target);
    if (id) setCursor(id);
  }

  function onCardKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    // While a card is lifted the arrows belong to the drag sensor.
    if (activeTaskId || activeColumnId) return;
    const step = STEPS[event.key];
    if (!step) return;
    // Keys typed in a composer, and keys on a column button, are not ours.
    const from = cardIdOf(event.target);
    if (!from) return;

    // Without this the column scrolls under the cursor.
    event.preventDefault();
    const next = cursorTarget(columns, from, step);
    if (!next || next === from) return;
    setCursor(next);
    focusCard(scrollRef.current, next);
  }

  if (!groupProperty) {
    return (
      <div className={styles.canvasWrap}>
        <div className={styles.blank}>
          This view has no grouping property. Open the project settings and point it at a select,
          person or checkbox property.
        </div>
      </div>
    );
  }

  return (
    <DndContext
      id="ushabti-board"
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveTaskId(null);
        setActiveColumnId(null);
        setPreview(null);
      }}
      autoScroll={{ threshold: { x: 0.18, y: 0.2 }, acceleration: 14 }}
    >
      <div className={styles.canvasWrap}>
        <div className={styles.canvas} ref={scrollRef} onFocus={onCardFocus} onKeyDown={onCardKeys}>
          <SortableContext
            items={columns.map((c) => COLUMN_PREFIX + c.id)}
            strategy={horizontalListSortingStrategy}
          >
            {columns.map((column) => (
              <Column
                key={column.id}
                column={column}
                addNote={addNote}
                selectedTaskId={selectedTaskId}
                cursorTaskId={cursorTaskId}
                draggable={columnsDraggable && !column.isNone}
                onOpenTask={onOpenTask}
                onAddTask={addTask}
              />
            ))}
          </SortableContext>
          <AddColumn />
        </div>
      </div>

      <DragOverlay dropAnimation={dropAnimation} zIndex={300}>
        {activeTask && <TaskCard task={activeTask} overlay />}
        {activeColumn && (
          <div className={styles.column} style={{ boxShadow: "var(--shadow-drag)" }}>
            <div className={styles.colHead}>
              <span style={{ width: 10 }} />
              <span className={styles.colTitle}>
                <span className={styles.colDot} style={{ background: activeColumn.color }} />
                <span className={styles.colName}>{activeColumn.name}</span>
              </span>
              <span className={styles.colCount}>{activeColumn.tasks.length}</span>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function AddColumn() {
  const { groupProperty, filters, addOption, setFilters } = useBoard();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  if (!groupProperty || groupProperty.type !== "select") return null;

  async function commit() {
    const trimmed = name.trim();
    setName("");
    setAdding(false);
    if (!trimmed || !groupProperty) return;
    const optionId = await addOption(groupProperty.id, trimmed);

    /*
     * A rule about the grouping property decides the columns, so a column made
     * under one would fail it and vanish the moment it was named. Nobody makes
     * a column in order not to see it: the new option joins the rule instead.
     */
    if (!optionId) return;
    const rules = filters.rules.map((rule) =>
      rule.propertyId === groupProperty.id && rule.op === "is"
        ? { ...rule, values: [...(rule.values ?? []), optionId] }
        : rule,
    );
    if (rules.some((rule, i) => rule !== filters.rules[i])) await setFilters(rules);
  }

  return (
    <div className={styles.addColumn}>
      {adding ? (
        <div className={styles.addColumnForm}>
          <input
            className={styles.popInput}
            autoFocus
            value={name}
            placeholder="Column name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
              if (e.key === "Escape") {
                setName("");
                setAdding(false);
              }
            }}
          />
          <div className={styles.row}>
            <button className={styles.primary} onClick={() => void commit()}>
              Add column
            </button>
            <button
              className={styles.ghost}
              onClick={() => {
                setName("");
                setAdding(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className={styles.addColumnButton} onClick={() => setAdding(true)}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          New column
        </button>
      )}
    </div>
  );
}
