"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
  type DragStartEvent,
  type DropAnimation,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  type SortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cursorTarget, sortByPosition, type BoardColumn, type CursorStep } from "@/lib/board";
import {
  canResize,
  clampWidth,
  listColumns,
  listTemplate,
  sortArrow,
  type ListColumn,
} from "@/lib/list-view";
import { seedNote, seedValues } from "@/lib/filters";
import { startsWith } from "@/lib/when";
import { canSort, pressSort, sortTasks, sortWayInline } from "@/lib/sort";
import type { ColumnWidths, TaskDTO } from "@/lib/types";
import { useCursorBack, useShortcut } from "./keys";
import { Composer } from "./Column";
import { useBoard } from "./store";
import { TaskRow, capOf, pinProps } from "./TaskRow";
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

/*
 * Whether anything has slid under the head or under the held cells, and
 * whether the table goes on past the right edge. Written straight onto the
 * elements, because a scroll event re-rendering forty rows to move one shadow
 * would be the slowest way to draw a hairline.
 */
function markScrolled(el: HTMLElement) {
  el.toggleAttribute("data-scrolled", el.scrollTop > 0);
  el.toggleAttribute("data-scrolled-x", el.scrollLeft > 0);
  /* A scrollbar that only shows while it is touched says nothing, so the edge
     of a table that goes on fades instead. It sits on the frame, which does
     not scroll, so the fade stays at the edge of the window. */
  el.parentElement?.toggleAttribute(
    "data-more-x",
    el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
  );
}

/** Which way a heading orders: both ways while it only offers, one once it does. */
const ARROW = {
  none: "M3 4l2-2 2 2M3 6l2 2 2-2",
  up: "M5 8.5V1.5M2.5 4L5 1.5 7.5 4",
  down: "M5 1.5v7M2.5 6L5 8.5 7.5 6",
};

/** The arrow follows the words beside it; see `sortArrow`. */
function SortArrow({ way }: { way: keyof typeof ARROW }) {
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden focusable="false">
      <path
        d={ARROW[way]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* A heading moves along the head and nowhere else. */
const alongTheHead: Modifier = ({ transform }) => ({ ...transform, y: 0 });

/*
 * Nothing in the head slides while a heading is carried. The columns under
 * the headings do not move until it is let go, so a heading that stepped
 * aside would sit over another column's values. A bar says where it lands.
 */
const STILL: SortingStrategy = () => null;

/*
 * The heading under the mouse, or the nearest one to its side. The lifted
 * copy is as wide as its column, so its centre can sit a whole column away
 * from where the person is pointing.
 */
const underThePointer: CollisionDetection = (args) => {
  const x = args.pointerCoordinates?.x;
  if (x === undefined) return closestCenter(args);
  let best: { container: (typeof args.droppableContainers)[number]; away: number } | null = null;
  for (const container of args.droppableContainers) {
    const rect = args.droppableRects.get(container.id);
    if (!rect) continue;
    const away = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    if (!best || away < best.away) best = { container, away };
  }
  return best
    ? [{ id: best.container.id, data: { droppableContainer: best.container, value: best.away } }]
    : [];
};

/** How far one press of an arrow moves a column's edge, and with Shift. */
const WIDTH_STEP = 16;
const WIDTH_LEAP = 64;

/*
 * Brings a row into view up and down, and never sideways. The key and the
 * title are held in place, so a row is always named wherever the table sits;
 * a sideways jump only hid the first property under the title.
 */
function showRow(root: HTMLElement | null, row: HTMLElement) {
  const left = root?.scrollLeft ?? 0;
  row.scrollIntoView({ block: "nearest" });
  if (root) root.scrollLeft = left;
}

function focusRow(root: HTMLElement | null, taskId: string) {
  const row = root?.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
  if (!row) return;
  row.focus({ preventScroll: true });
  showRow(root, row);
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
    lensWidths,
    setWidths,
    moveProperty,
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
  const gridRef = useRef<HTMLDivElement>(null);
  /* Where the table sat sideways before the last scroll, so a focus that
     scrolled it can be put back. The scroll event comes a frame after the
     focus, so this still holds the old place when the focus arrives. */
  const restingLeft = useRef(0);
  /* The lifted row is drawn outside the grid, so it is handed the columns as
     they stand in pixels. */
  const [liftedCols, setLiftedCols] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A list has one composer, at the end, so `n` has one place to open it.
  useShortcut("n", () => {
    if (!activeTaskId) setComposing(true);
  });

  /* The width of the column whose edge is under the hand, drawn as it moves
     and written once when it is let go. A write on every pixel would be a
     request on every pixel. */
  const [live, setLive] = useState<{ id: string; width: number } | null>(null);
  const widths = useMemo<ColumnWidths>(
    () => (live ? { ...lensWidths, [live.id]: live.width } : lensWidths),
    [lensWidths, live],
  );
  const columns = useMemo(() => listColumns(cardItems, widths), [cardItems, widths]);
  const template = useMemo(() => listTemplate(columns), [columns]);

  /*
   * The rank every view shares, unless somebody asked a heading for another
   * order. A sort writes nothing, so the rank underneath is untouched and the
   * boards go on showing it.
   */
  const base = useMemo(
    () => sortTasks(sortByPosition(visibleTasks), sort, cardItems, data.members, data.former),
    [visibleTasks, sort, cardItems, data.members, data.former],
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
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-task-id="${selectedTaskId}"]`);
    if (row) showRow(scrollRef.current, row);
  }, [selectedTaskId]);

  /* The edges are read again whenever the table or its window changes size,
     not only on a scroll: a list that opens wider than its window has to say
     so before anybody touches it. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    markScrolled(el);
    const observer = new ResizeObserver(() => markScrolled(el));
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  /*
   * A list has no columns, so nothing else decides the grouping property and
   * the filter has to answer for it too. Without the null the row is written
   * and hidden in the same breath, with nothing on screen to say why.
   */
  const seed = seedValues(filters, data.properties, null, user.id, data.today, data.former);
  const addNote = seedNote(
    seed,
    data.properties,
    data.members,
    startsWith(data.project.typeBy, seed, data.properties),
  );

  const activeTask = activeTaskId ? (data.tasks.find((t) => t.id === activeTaskId) ?? null) : null;

  /*
   * A heading of a property moves that property, in the one order Settings
   * drags: a list holds no order of its own, so a column moved here moves on
   * every card and in the panel too. It is dropped by naming what it landed
   * on, exactly as Settings does. The key, the title and the parts a task has
   * of its own stay where `listColumns` puts them.
   *
   * A mouse only. A finger on a heading is somebody scrolling a wide list
   * sideways, and a phone moves a property in Settings.
   */
  const mayMove = data.project.mayStructure;
  const movable = useMemo(
    () => (mayMove ? columns.filter((c) => c.item.property).map((c) => c.id) : []),
    [columns, mayMove],
  );
  const headSensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }));
  const [carried, setCarried] = useState<{ id: string; over: string | null } | null>(null);
  /* How far down the bar reaches: through every row, so it reads as the line
     the column will stand on and not as a mark on one heading. */
  const [lineHeight, setLineHeight] = useState(0);
  const carriedColumn = carried ? columns.find((c) => c.id === carried.id) : undefined;

  /* Which side of a heading the carried one lands on: past it, in the way it
     is going, as `landedAfter` puts it. */
  function markerOf(id: string): "before" | "after" | undefined {
    if (!carried || carried.over !== id || carried.id === id) return undefined;
    return movable.indexOf(carried.id) < movable.indexOf(id) ? "after" : "before";
  }

  function onHeadDragOver({ active, over }: DragOverEvent) {
    setCarried({ id: String(active.id), over: over ? String(over.id) : null });
  }

  function onHeadDragEnd({ active, over }: DragEndEvent) {
    setCarried(null);
    if (!over || active.id === over.id) return;
    void moveProperty(String(active.id), String(over.id));
  }

  /* A width the person asked for, written to their lens. Only a change is
     written, so a press on an edge that went nowhere sends nothing. */
  function writeWidth(id: string, width: number | null) {
    setLive(null);
    if (width === null) {
      if (!(id in lensWidths)) return;
      const rest = { ...lensWidths };
      delete rest[id];
      void setWidths(rest);
      return;
    }
    if (lensWidths[id] === width) return;
    void setWidths({ ...lensWidths, [id]: width });
  }

  function onDragStart(event: DragStartEvent) {
    /* A grid's computed template is its tracks as laid out, in pixels. */
    setLiftedCols(gridRef.current ? getComputedStyle(gridRef.current).gridTemplateColumns : null);
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
        selectedTaskId,
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
     moves the cursor with it. The browser scrolls a focused row into view
     sideways too, and the first Tab slid Priority under the title; the held
     key and title already name the row, so the table is put back where it
     was. */
  function onRowFocus(event: React.FocusEvent<HTMLDivElement>) {
    const id = rowIdOf(event.target);
    if (!id) return;
    setCursor(id);
    const el = event.currentTarget;
    if (el.scrollLeft !== restingLeft.current) el.scrollLeft = restingLeft.current;
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
          onScroll={(event) => {
            restingLeft.current = event.currentTarget.scrollLeft;
            markScrolled(event.currentTarget);
          }}
          style={{ "--list-cols": template } as React.CSSProperties}
        >
          <div className={styles.listGrid} ref={gridRef}>
            {/* A heading that can order the list is a button. The order is
                mine and writes no rank, so the rank everybody shares is still
                the one the boards draw; see `pressSort`. A list has no Sort
                button, so the heading also has to say it can be pressed. */}
            <DndContext
              id="ushabti-list-head"
              sensors={headSensors}
              collisionDetection={underThePointer}
              modifiers={[alongTheHead]}
              onDragStart={({ active }) => {
                setLineHeight(gridRef.current?.offsetHeight ?? 0);
                setCarried({ id: String(active.id), over: null });
              }}
              onDragOver={onHeadDragOver}
              onDragEnd={onHeadDragEnd}
              onDragCancel={() => setCarried(null)}
            >
              <SortableContext items={movable} strategy={STILL}>
                <div
                  className={styles.listHead}
                  data-testid="list-head"
                  style={{ "--list-line": `${lineHeight}px` } as React.CSSProperties}
                >
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
                    ]
                      .filter(Boolean)
                      .join(" ");

                    const slot = {
                      column,
                      className: held.className,
                      style: { ...held.style, ...capOf(column) },
                      onLive: (width: number) => setLive({ id: column.id, width }),
                      onDone: (width: number | null) => writeWidth(column.id, width),
                    };

                    if (!canSort(column.item)) {
                      return (
                        <HeadSlot key={column.id} {...slot}>
                          {() => <span className={className}>{column.name}</span>}
                        </HeadSlot>
                      );
                    }

                    const Slot = movable.includes(column.id) ? MovableHeadSlot : HeadSlot;
                    return (
                      <Slot key={column.id} {...slot} marker={markerOf(column.id)}>
                        {(grab) => (
                          <button
                            type="button"
                            {...grab}
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
                            <span
                              className={`${styles.listHeadArrow} ${on ? "" : styles.listHeadHint}`}
                              aria-hidden
                            >
                              <SortArrow way={on ? sortArrow(column.item, on) : "none"} />
                            </span>
                          </button>
                        )}
                      </Slot>
                    );
                  })}
                </div>
              </SortableContext>
              <DragOverlay dropAnimation={null} zIndex={300}>
                {carriedColumn && (
                  <div className={`${styles.listHeadCell} ${styles.listHeadLifted}`}>
                    <span className={styles.listHeadWords}>{carriedColumn.name}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>

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
                <div className={styles.listComposeSlot}>
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
                <span className={styles.listAddWords}>
                  <span className={styles.listAddPlus} aria-hidden>
                    +
                  </span>
                  Add a task
                </span>
              </button>
            )}

            {/* The first list a person sees is a row of headings over nothing.
                The words that explain it sit under the way in, where the eye
                already is, and not at the foot of the window. */}
            {data.tasks.length === 0 && (
              <p className={styles.listFirst} data-testid="list-first">
                The columns of a list are what a card carries, which you arrange on the{" "}
                <Link href={`/p/${data.project.id}/settings/card`}>Card</Link> page. Every field on
                a task is a property of yours — Status, Priority, Assignee and the rest — so you can
                rename or delete any of them.
              </p>
            )}
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={dropAnimation} zIndex={300}>
        {activeTask && (
          <div style={{ ["--list-cols" as string]: liftedCols ?? template }}>
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

type Grab = ReturnType<typeof useSortable>["listeners"];

type HeadSlotProps = {
  column: ListColumn;
  className: string;
  style: React.CSSProperties;
  /** The width the edge is at while it is being dragged. */
  onLive: (width: number) => void;
  /** The width it was let go at, or null to give the column its own back. */
  onDone: (width: number | null) => void;
  /** The heading itself, handed what picks it up when it can be moved. */
  children: (grab: Grab) => React.ReactNode;
  /** Which side of this heading a carried one would land on. */
  marker?: "before" | "after";
};

/**
 * One heading's place in the head: the heading, and the edge that drags the
 * column wider. The edge sits beside the button and not inside it, so a drag
 * of the edge is never a press of the heading.
 */
function HeadSlot({
  column,
  className,
  style,
  onLive,
  onDone,
  children,
  marker,
  sortable,
}: HeadSlotProps & {
  sortable?: {
    ref: (node: HTMLElement | null) => void;
    grab: Grab;
    moving: boolean;
  };
}) {
  return (
    <div
      ref={sortable?.ref}
      className={`${styles.listHeadSlot} ${className}`}
      style={style}
      data-moving={sortable?.moving ? "true" : undefined}
      data-marker={marker}
      data-testid="list-head-slot"
    >
      {children(sortable?.grab)}
      {canResize(column.item) && <ColumnEdge column={column} onLive={onLive} onDone={onDone} />}
    </div>
  );
}

/* The heading stays where it is while it is carried: what moves is the
   overlay, and the bar beside the heading it would land by. */
function MovableHeadSlot(props: HeadSlotProps) {
  const { setNodeRef, listeners, isDragging } = useSortable({
    id: props.column.id,
    data: { type: "column" },
  });
  return (
    <HeadSlot {...props} sortable={{ ref: setNodeRef, grab: listeners, moving: isDragging }} />
  );
}

/**
 * The right edge of a heading. Dragged, it sets the column's width; pressed
 * twice, it gives the column back the width its content gives it. The arrow
 * keys move it too, a step at a time, and Delete gives the width back, so the
 * keyboard can do what the mouse does.
 */
function ColumnEdge({
  column,
  onLive,
  onDone,
}: {
  column: ListColumn;
  onLive: (width: number) => void;
  onDone: (width: number | null) => void;
}) {
  const drag = useRef<{ x: number; from: number; at: number } | null>(null);

  const widthNow = (edge: HTMLElement) =>
    column.chosen ?? Math.round(edge.parentElement?.getBoundingClientRect().width ?? 0);

  function hold(on: boolean) {
    document.body.style.cursor = on ? "col-resize" : "";
    document.body.style.userSelect = on ? "none" : "";
  }

  /* A column can leave the list while its edge is held, when somebody takes
     it off the card. The page must not keep the resize cursor for good. */
  useEffect(
    () => () => {
      if (drag.current) hold(false);
    },
    [],
  );

  function onPointerDown(event: React.PointerEvent<HTMLSpanElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const from = widthNow(event.currentTarget);
    drag.current = { x: event.clientX, from, at: from };
    event.currentTarget.setPointerCapture(event.pointerId);
    hold(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLSpanElement>) {
    const d = drag.current;
    if (!d) return;
    d.at = clampWidth(column.id, d.from + event.clientX - d.x);
    onLive(d.at);
  }

  function onPointerUp() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    hold(false);
    /* A press that went nowhere leaves a column that sizes itself alone. */
    onDone(d.at === d.from ? column.chosen : d.at);
  }

  function onPointerCancel() {
    if (!drag.current) return;
    drag.current = null;
    hold(false);
    onDone(column.chosen);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLSpanElement>) {
    const step = event.shiftKey ? WIDTH_LEAP : WIDTH_STEP;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const by = event.key === "ArrowRight" ? step : -step;
      onDone(clampWidth(column.id, widthNow(event.currentTarget) + by));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDone(null);
    }
  }

  return (
    <span
      className={styles.listHeadEdge}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Width of ${column.name}`}
      aria-valuenow={column.chosen ?? undefined}
      tabIndex={0}
      title="Drag to resize. Double-click to fit."
      data-testid="list-head-edge"
      data-chosen={column.chosen !== null ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={() => onDone(null)}
      onKeyDown={onKeyDown}
    />
  );
}
