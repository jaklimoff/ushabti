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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cursorTarget, sortByPosition, type BoardColumn, type CursorStep } from "@/lib/board";
import { REST, dragColumns, type DragColumn } from "@/lib/column-fit";
import {
  canResize,
  columnMin,
  listColumns,
  listTemplate,
  shareOf,
  sortArrow,
  type ListColumn,
} from "@/lib/list-view";
import { seedNote, seedValues } from "@/lib/filters";
import { startsWith } from "@/lib/when";
import { canSort, pressSort, sortTasks, sortWayInline } from "@/lib/sort";
import type { AgentRunDTO, TaskDTO } from "@/lib/types";
import { useSameIds, useStable } from "@/components/ui/useStable";
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
/*
 * How wide the list's window is, as a variable its kept widths are drawn
 * against. A share of the grid itself was a share of something that changes
 * the moment the share is drawn: a list wider than its window shrank on the
 * drop. The window does not change with what is in it.
 */
function markPanel(el: HTMLElement) {
  el.style.setProperty("--list-panel", `${el.clientWidth}px`);
}

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

/* Made once: a new options object is a new sensor, and a new sensor hands
   every row new listeners, which draws every row again for nothing. */
const ROW_POINTER = { activationConstraint: { distance: 5 } };
const ROW_KEYS = {
  coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
};

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
  litColumnId = null,
}: {
  selectedTaskId: string | null;
  onOpenTask: (task: TaskDTO | null) => void;
  /** The column the Columns drawer is changing, whose heading lights up. */
  litColumnId?: string | null;
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
    isPicked,
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

  /* Every column's width in pixels while an edge is held, drawn as it moves
     and written once when it is let go. A write on every pixel would be a
     request on every pixel. */
  const [live, setLive] = useState<Record<string, number> | null>(null);
  const columns = useMemo(
    () => listColumns(cardItems, lensWidths, live),
    [cardItems, lensWidths, live],
  );
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
    useSensor(PointerSensor, ROW_POINTER),
    // Space picks a row up and puts it down. Enter is left alone so it can
    // still open the task.
    //
    // dnd-kit's own coordinate getter is right here, and the board's is not:
    // `liftedCardCoordinates` exists to beat a column that is as tall as the
    // board and loses every sum of corner distances. A single vertical list has
    // no such container. Do not unify the two.
    useSensor(KeyboardSensor, ROW_KEYS),
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
    markPanel(el);
    const observer = new ResizeObserver(() => {
      markScrolled(el);
      markPanel(el);
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  /*
   * A list has no columns, so nothing else decides the grouping property and
   * the filter has to answer for it too. Without the null the row is written
   * and hidden in the same breath, with nothing on screen to say why.
   */
  /* A Tasks rule seeds a task that is still here, and says it by its key. */
  const named = [...data.tasks, ...data.archived];
  const seed = seedValues(filters, data.properties, null, user.id, data.today, data.former, named);
  const addNote = seedNote(
    seed,
    data.properties,
    data.members,
    startsWith(data.project.typeBy, seed, data.properties),
    named,
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

  /*
   * Dragging a column's edge. The row is measured once, when the edge is
   * taken, and every step works from that: the dragged column goes where the
   * pointer is, and `dragColumns` says what the others give. The room is the
   * row as it stood, the empty space at the end included, so a drag never
   * pushes the table past the window.
   */
  const resize = useRef<{
    id: string;
    x: number;
    row: DragColumn[];
    total: number;
    at: Record<string, number> | null;
    stop: () => void;
  } | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);

  /** The row as it is drawn: every column a drag can touch, and the room at the end. */
  function measureRow(): { row: DragColumn[]; total: number; panel: number } | null {
    const grid = gridRef.current;
    if (!grid) return null;
    const slots = [...grid.querySelectorAll<HTMLElement>("[data-column-id]")];
    const row: DragColumn[] = [];
    let last = 0;
    for (const slot of slots) {
      const column = columns.find((c) => c.id === slot.dataset.columnId);
      if (!column || !canResize(column.item)) continue;
      const rect = slot.getBoundingClientRect();
      const width = Math.round(rect.width);
      /* A column already narrower than the floor is not pushed out to it by a
         drag somewhere else. */
      row.push({
        id: column.id,
        width,
        min: Math.min(columnMin(column.id), width),
        resizable: true,
      });
      last = rect.right;
    }
    const rest = Math.max(0, Math.round(grid.getBoundingClientRect().right - last - 8));
    row.push({ id: REST, width: rest, min: 0, resizable: true });
    const panel = scrollRef.current?.clientWidth ?? 0;
    return { row, total: row.reduce((sum, c) => sum + c.width, 0), panel };
  }

  /** The widths a step leaves: the dragged column set to `width`, the rest giving way. */
  function stepRow(row: DragColumn[], id: string, width: number, total: number) {
    const dragged = row.find((c) => c.id === id);
    if (!dragged) return null;
    const moved = row.map((c) => (c.id === id ? { ...c, width: Math.max(width, c.min) } : c));
    const changes = dragColumns(moved, id, total);
    const out: Record<string, number> = {};
    for (const c of moved) if (c.id !== REST) out[c.id] = changes.get(c.id) ?? c.width;
    return out;
  }

  /* Every resizable column is kept as its share of the list, not only the one
     dragged: its neighbours gave it their room, and they keep what they have. */
  function writeShares(widths: Record<string, number>, panel: number) {
    if (!panel) return;
    const next = { ...lensWidths };
    for (const [id, width] of Object.entries(widths)) next[id] = shareOf(width, panel);
    void setWidths(next);
  }

  function endResize(keep: boolean) {
    const r = resize.current;
    if (!r) return;
    resize.current = null;
    r.stop();
    setResizing(null);
    setLive(null);
    if (keep && r.at) writeShares(r.at, scrollRef.current?.clientWidth ?? 0);
  }

  function startResize(id: string, x: number) {
    endResize(false);
    const measured = measureRow();
    if (!measured) return;

    /* The page listens, not the edge: an edge that missed the pointer going up
       kept on resizing under a plain hover. A move with no button down ends
       the drag too, for a release the page never heard. */
    const onMove = (event: PointerEvent) => {
      const r = resize.current;
      if (!r) return;
      if ((event.buttons & 1) === 0) return endResize(true);
      const start = r.row.find((c) => c.id === r.id)?.width ?? 0;
      const at = stepRow(r.row, r.id, start + event.clientX - r.x, r.total);
      if (!at) return;
      r.at = at;
      setLive(at);
    };
    const onUp = () => endResize(true);
    const onCancel = () => endResize(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onUp);

    resize.current = {
      id,
      x,
      row: measured.row,
      total: measured.total,
      at: null,
      stop: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("blur", onUp);
      },
    };
    setResizing(id);
  }

  /* A list that goes away with an edge in hand leaves nothing listening. */
  useEffect(() => () => resize.current?.stop(), []);

  useEffect(() => {
    document.body.classList.toggle("ushabti-resizing", resizing !== null);
    return () => document.body.classList.remove("ushabti-resizing");
  }, [resizing]);

  /** One press of an arrow on a focused edge: the same step a drag takes. */
  function stepWidth(id: string, by: number) {
    const measured = measureRow();
    if (!measured) return;
    const start = measured.row.find((c) => c.id === id)?.width ?? 0;
    const at = stepRow(measured.row, id, start + by, measured.total);
    if (at) writeShares(at, measured.panel);
  }

  /* Back to the width its content gives it. The others keep theirs. */
  function resetWidth(id: string) {
    if (!(id in lensWidths)) return;
    const rest = { ...lensWidths };
    delete rest[id];
    void setWidths(rest);
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
  /* One function for the life of the list, so a row that did not change
     does not draw again for a new handler. */
  const rowIds = useSameIds(rows);
  const pickRow = useStable((taskId: string, event: React.MouseEvent) => {
    if (event.shiftKey)
      pickTo(
        taskId,
        rows.map((t) => t.id),
        selectedTaskId,
      );
    else togglePick(taskId);
  });
  const openRow = useStable((taskId: string) => {
    const task = rows.find((t) => t.id === taskId);
    if (task) onOpenTask(task);
  });

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
                      lit: litColumnId === column.id,
                      className: held.className,
                      style: { ...held.style, ...capOf(column) },
                      resizing: resizing === column.id,
                      onGrab: (x: number) => startResize(column.id, x),
                      onStep: (by: number) => stepWidth(column.id, by),
                      onReset: () => resetWidth(column.id),
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

            <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
              {rows.map((task) => (
                <SortableRow
                  key={task.id}
                  task={task}
                  columns={columns}
                  selected={selectedTaskId === task.id}
                  cursor={cursorTaskId === task.id}
                  frozen={sorted}
                  picked={isPicked(task.id)}
                  run={runOf(task.id)}
                  onOpen={openRow}
                  onPick={pickRow}
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
            <TaskRow
              task={activeTask}
              columns={columns}
              run={runOf(activeTask.id)}
              picked={isPicked(activeTask.id)}
              overlay
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

const ROW_DATA = { type: "row" };
const ROW_MOVE = { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" };

/* Every prop holds still while its task does, for the reason `SortableTask`
   in Column.tsx gives. */
const SortableRow = memo(function SortableRow({
  task,
  columns,
  selected,
  cursor,
  frozen,
  picked,
  run,
  onOpen,
  onPick,
}: {
  task: TaskDTO;
  columns: ReturnType<typeof listColumns>;
  selected: boolean;
  cursor: boolean;
  /** A sorted list is not showing ranks, so there is no rank to drag one to. */
  frozen: boolean;
  picked: boolean;
  run: AgentRunDTO | null;
  onOpen: (taskId: string) => void;
  onPick: (taskId: string, event: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: ROW_DATA,
    disabled: frozen,
    transition: ROW_MOVE,
  });
  const moved = CSS.Translate.toString(transform);
  const style = useMemo(
    () => ({ transform: moved, transition: transition ?? undefined }),
    [moved, transition],
  );
  const dragProps = useMemo(() => ({ ...attributes, ...listeners }), [attributes, listeners]);
  const id = task.id;
  const open = useCallback(() => onOpen(id), [onOpen, id]);
  const pick = useCallback((event: React.MouseEvent) => onPick(id, event), [onPick, id]);

  return (
    <TaskRow
      ref={setNodeRef}
      task={task}
      columns={columns}
      selected={selected}
      cursor={cursor}
      ghost={isDragging}
      picked={picked}
      run={run}
      onOpen={open}
      onPick={pick}
      style={style}
      dragProps={dragProps}
    />
  );
});

type Grab = ReturnType<typeof useSortable>["listeners"];

type HeadSlotProps = {
  column: ListColumn;
  /** The Columns drawer is changing this column. */
  lit?: boolean;
  className: string;
  style: React.CSSProperties;
  /** Whether this column's edge is in hand. */
  resizing: boolean;
  /** The edge was taken at `x`. */
  onGrab: (x: number) => void;
  /** An arrow key moved the edge by `by` pixels. */
  onStep: (by: number) => void;
  /** Gives the column back the width its content gives it. */
  onReset: () => void;
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
  lit,
  className,
  style,
  resizing,
  onGrab,
  onStep,
  onReset,
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
      data-lit={lit ? "true" : undefined}
      data-marker={marker}
      data-column-id={column.id}
      data-testid="list-head-slot"
    >
      {children(sortable?.grab)}
      {canResize(column.item) && (
        <ColumnEdge
          column={column}
          resizing={resizing}
          onGrab={onGrab}
          onStep={onStep}
          onReset={onReset}
        />
      )}
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
 * The right edge of a heading. Dragged, it sets the column's width and the
 * columns to its right give way; pressed twice, it gives the column back the
 * width its content gives it. The arrow keys move it too, a step at a time,
 * and Delete gives the width back, so the keyboard can do what the mouse does.
 * The list does the arithmetic; the edge only says what the hand did.
 */
function ColumnEdge({
  column,
  resizing,
  onGrab,
  onStep,
  onReset,
}: {
  column: ListColumn;
  resizing: boolean;
  onGrab: (x: number) => void;
  onStep: (by: number) => void;
  onReset: () => void;
}) {
  function onPointerDown(event: React.PointerEvent<HTMLSpanElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onGrab(event.clientX);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLSpanElement>) {
    const step = event.shiftKey ? WIDTH_LEAP : WIDTH_STEP;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onStep(event.key === "ArrowRight" ? step : -step);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onReset();
    }
  }

  return (
    <span
      className={styles.listHeadEdge}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Width of ${column.name}`}
      tabIndex={0}
      title="Drag to resize. Double-click to fit."
      data-testid="list-head-edge"
      data-active={resizing ? "true" : undefined}
      data-sized={column.track !== null ? "true" : undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
