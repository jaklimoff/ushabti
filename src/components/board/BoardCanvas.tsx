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
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildColumns, sortByPosition, type BoardColumn } from "@/lib/board";
import type { TaskValue } from "@/lib/types";
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

export function BoardCanvas({
  selectedTaskId,
  onOpenTask,
}: {
  selectedTaskId: string | null;
  onOpenTask: (id: string | null) => void;
}) {
  const { data, groupProperty, moveTask, createTask, patchOption, runOf, controlRun, notify } =
    useBoard();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [preview, setPreview] = useState<BoardColumn[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const base = useMemo(
    () => buildColumns(groupProperty, sortByPosition(data.tasks), data.members),
    [data.tasks, data.members, groupProperty],
  );

  const columns = preview ?? base;
  const columnsDraggable = groupProperty?.type === "select";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Space picks a card up and puts it down. Enter is left alone so it can
    // still open the task.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  useEffect(() => {
    const dragging = activeTaskId !== null || activeColumnId !== null;
    document.body.classList.toggle("ushabti-dragging", dragging);
    return () => document.body.classList.remove("ushabti-dragging");
  }, [activeTaskId, activeColumnId]);

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
    const values: Record<string, TaskValue> = {};
    if (groupProperty && !column.isNone) values[groupProperty.id] = column.value;
    const neighbour = atTop ? null : (column.tasks.at(-1)?.id ?? null);
    const task = await createTask({ title, values, afterId: neighbour, atTop });
    if (task) onOpenTask(task.id);
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
        <div className={styles.canvas} ref={scrollRef}>
          <SortableContext
            items={columns.map((c) => COLUMN_PREFIX + c.id)}
            strategy={horizontalListSortingStrategy}
          >
            {columns.map((column) => (
              <Column
                key={column.id}
                column={column}
                properties={data.properties}
                members={data.members}
                groupProperty={groupProperty}
                selectedTaskId={selectedTaskId}
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
        {activeTask && (
          <TaskCard
            task={activeTask}
            properties={data.properties}
            members={data.members}
            groupPropertyId={groupProperty.id}
            overlay
          />
        )}
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
  const { groupProperty, addOption } = useBoard();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  if (!groupProperty || groupProperty.type !== "select") return null;

  async function commit() {
    const trimmed = name.trim();
    setName("");
    setAdding(false);
    if (trimmed && groupProperty) await addOption(groupProperty.id, trimmed);
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
