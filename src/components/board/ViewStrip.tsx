"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GROUPABLE_TYPES,
  GROUPED_KINDS,
  isSelect,
  VIEW_KIND_LABEL,
  VIEW_KINDS,
  type ViewDTO,
  type ViewKind,
} from "@/lib/types";
import { useDismiss } from "@/components/ui/useDismiss";
import { useEdgeFade } from "./edges";
import { FilterButton, SortButton } from "./Filters";
import { copyText } from "@/lib/clipboard";
import { useBoard } from "./store";
import styles from "./board.module.css";

const VIEW_DOTS = ["#3fb0c8", "#6d5bd0", "#2f9e7a", "#d1913a", "#c2557a", "#4b8fbe"];

/* The colour follows the view and not its place in the strip. A pill that
   changed colour the moment it was dragged past its neighbour would read as a
   different view. */
function dotOf(view: ViewDTO): string {
  let sum = 0;
  for (const ch of view.id) sum = (sum + ch.charCodeAt(0)) % 4093;
  return VIEW_DOTS[sum % VIEW_DOTS.length];
}

export function ViewStrip({
  filterOpen,
  setFilterOpen,
  sortOpen,
  setSortOpen,
}: {
  filterOpen: boolean;
  setFilterOpen: (v: boolean) => void;
  sortOpen: boolean;
  setSortOpen: (v: boolean) => void;
}) {
  const { data, view, visibleTasks, setViewId, createView, moveView } = useBoard();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ViewKind>("board");
  /* A roadmap draws the dated options of a select, so it offers selects alone. */
  const groupable = data.properties.filter((p) =>
    kind === "roadmap" ? isSelect(p.type) : GROUPABLE_TYPES.includes(p.type),
  );
  const [picked, setGroupById] = useState(groupable[0]?.id ?? "");
  const groupById = groupable.some((p) => p.id === picked) ? picked : (groupable[0]?.id ?? "");
  const ref = useDismiss<HTMLDivElement>(() => setAdding(false), adding);

  const plusRef = useRef<HTMLButtonElement>(null);
  const [popLeft, setPopLeft] = useState(14);

  /* The same row the column strip is: pills that pan, and a fade at each end
     that has more. */
  const { ref: stripRef, fade, measure } = useEdgeFade(data.views.length);

  const taskCount = data.tasks.length;
  const shown = visibleTasks.length;

  // The panel used to open at the far left however far right the + had moved.
  useLayoutEffect(() => {
    if (!adding || !plusRef.current || !ref.current) return;
    const anchor = plusRef.current.getBoundingClientRect();
    const host = ref.current.getBoundingClientRect();
    const width = 262;
    const left = anchor.left - host.left - width / 2 + anchor.width / 2;
    setPopLeft(Math.max(10, Math.min(left, host.width - width - 10)));
  }, [adding, ref]);

  /* Three pills all reading "List" is a mess that costs four lines to stop. */
  function untakenName(word: string): string {
    const taken = new Set(data.views.map((v) => v.name.toLowerCase()));
    if (!taken.has(word.toLowerCase())) return word;
    for (let n = 2; ; n += 1) if (!taken.has(`${word.toLowerCase()} ${n}`)) return `${word} ${n}`;
  }

  async function submit() {
    const chosen = groupById || groupable[0]?.id || null;
    /* A board is its columns and cannot be made without one. A list groups
       nothing, so it can be made on a project that has no such property —
       which used to make the whole + a dead end. */
    const grouped = GROUPED_KINDS.includes(kind);
    if (grouped && !chosen) return;
    const property = data.properties.find((p) => p.id === chosen);
    const fallback =
      kind === "list"
        ? untakenName("List")
        : kind === "roadmap"
          ? untakenName("Roadmap")
          : `By ${property?.name.toLowerCase() ?? "property"}`;
    const title = name.trim() || fallback;
    setName("");
    setAdding(false);
    await createView(title, kind, grouped ? chosen : null);
  }

  /* A pill is a button first: it only becomes a drag once the pointer has
     travelled. dnd-kit swallows the click that follows a real drag, so the two
     never happen at once. */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void moveView(String(active.id), String(over.id));
  }

  return (
    <div className={styles.views} ref={ref}>
      {/* One row of pills, all the same height, so dnd-kit's own answer is
          the right one here. The board overrides both because a column is as
          tall as the whole board; nothing in this strip is. */}
      <DndContext
        id="ushabti-views"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <div className={`${styles.viewStrip} ${fade}`} ref={stripRef} onScroll={measure}>
          <SortableContext
            items={data.views.map((v) => v.id)}
            strategy={horizontalListSortingStrategy}
          >
            {data.views.map((v) => (
              <ViewPill
                key={v.id}
                view={v}
                active={v.id === view?.id}
                onPick={() => setViewId(v.id)}
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>

      <button
        ref={plusRef}
        className={styles.plus}
        aria-label="New view"
        aria-expanded={adding}
        title="New view"
        onClick={() => {
          setAdding((v) => !v);
          setKind("board");
          setGroupById(groupable[0]?.id ?? "");
        }}
      >
        +
      </button>

      <div style={{ flex: 1 }} />
      {/* A list is ordered by its headings, which it has and a board has not.
          So the button is here only where there is nothing else to press. */}
      {view?.kind === "board" && <SortButton open={sortOpen} setOpen={setSortOpen} />}
      <FilterButton open={filterOpen} setOpen={setFilterOpen} />
      {/* A filtered board says how much of itself it is showing. "12 tasks"
          alone cannot tell you whether the other 28 exist. */}
      <span className={styles.count} data-testid="task-count">
        {shown === taskCount ? shown : `${shown} of ${taskCount}`}{" "}
        {taskCount === 1 ? "task" : "tasks"}
      </span>

      {adding && (
        <div className={styles.popover} style={{ left: popLeft }}>
          <span className="label">New view</span>
          <input
            className={styles.popInput}
            autoFocus
            value={name}
            aria-label="Name of the new view"
            placeholder="View name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") setAdding(false);
            }}
          />
          {/* The name box keeps the caret, so the block that comes and goes is
              the last one and nothing ever moves above the cursor. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">Shows as</span>
            <div className={styles.chipRow} role="group" aria-label="What the new view shows">
              {VIEW_KINDS.map((option) => (
                <button
                  key={option}
                  className={`${styles.chip} ${kind === option ? styles.chipOn : ""}`}
                  aria-pressed={kind === option}
                  onClick={() => setKind(option)}
                >
                  <ViewKindMark kind={option} on={kind === option} />
                  {VIEW_KIND_LABEL[option]}
                </button>
              ))}
            </div>
          </div>

          {GROUPED_KINDS.includes(kind) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label" id="new-view-columns">
                {kind === "roadmap" ? "Rows from" : "Columns by"}
              </span>
              <div className={styles.chipRow} role="group" aria-labelledby="new-view-columns">
                {groupable.map((property) => (
                  <button
                    key={property.id}
                    className={`${styles.chip} ${groupById === property.id ? styles.chipOn : ""}`}
                    aria-pressed={groupById === property.id}
                    onClick={() => setGroupById(property.id)}
                  >
                    <span
                      className={styles.dot6}
                      style={{
                        background: property.options[0]?.color ?? "#4b8fbe",
                        opacity: groupById === property.id ? 1 : 0.45,
                      }}
                    />
                    {property.name}
                  </button>
                ))}
              </div>
              {groupable.length === 0 && (
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {kind === "roadmap"
                    ? "Create a select property first."
                    : "Create a select, person or checkbox property first."}
                </span>
              )}
              {kind === "roadmap" && groupable.length > 0 && (
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  One bar for each option with a target date.
                </span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              One row for each task, in the order the board already has.
            </span>
          )}
          <div className={styles.row}>
            <button className={styles.primary} onClick={() => void submit()}>
              Create view
            </button>
            <button className={styles.ghost} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          {/*
           * Deleting used to live on the active pill, which put a delete
           * control under the cursor that had just selected the view.
           */}
          <Link className={styles.popLink} href={`/p/${data.project.id}/settings/views`}>
            Change or delete a view →
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * One view in the strip. It picks the view on a click and changes the order on
 * a drag, and the two cannot be confused: the drag starts only after the
 * pointer has moved five pixels.
 *
 * The keyboard picks a view here and orders them in settings. A pill answers
 * Space and Enter the way every other button does, which is worth more in the
 * top bar than a second way to say the same thing.
 *
 * So the pill must not say otherwise. dnd-kit hands every sortable a role
 * description and a line of instructions for a keyboard drag, and this strip
 * has no keyboard sensor to keep that promise. Those two are dropped, and the
 * tooltip names the view, because a long name is cut short on the pill.
 *
 * The open view carries a second button beside it that copies its link. It is
 * a button of its own and not a menu on the pill, so a click still picks, a
 * drag still moves, and Tab reaches it. It shows on hover and focus, and
 * always on a screen without a pointer to hover with.
 */
function ViewPill({
  view,
  active,
  onPick,
}: {
  view: ViewDTO;
  active: boolean;
  onPick: () => void;
}) {
  const { data, notify } = useBoard();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: view.id,
    transition: { duration: 190, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });
  const color = active ? dotOf(view) : "#3f4650";
  const {
    "aria-roledescription": _roledescription,
    "aria-describedby": _describedby,
    ...buttonAttributes
  } = attributes;

  /* The same words as a task's link, and the same shape as the address bar's,
     built from wherever the board is served. */
  async function copyLink() {
    const link = `${window.location.origin}/p/${data.project.id}?view=${view.id}`;
    if (await copyText(link)) notify("Link copied", "info");
    else notify("The link did not copy. The address bar holds it.");
  }

  return (
    <span
      ref={setNodeRef}
      className={[styles.pillWrap, isDragging ? styles.pillLifted : ""].filter(Boolean).join(" ")}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined,
      }}
    >
      <button
        className={[styles.pill, active ? styles.pillActive : ""].filter(Boolean).join(" ")}
        data-testid="view-pill"
        title={view.name}
        aria-current={active ? "true" : undefined}
        onClick={onPick}
        {...buttonAttributes}
        {...listeners}
      >
        {/* The one place the two kinds sit side by side, so the mark earns its
          pixels. */}
        {view.kind !== "board" ? (
          <ViewKindMark kind={view.kind} on={active} color={color} />
        ) : (
          <span className={styles.pillDot} style={{ background: color }} />
        )}
        {view.name}
      </button>
      {active && (
        <button
          className={styles.pillLink}
          aria-label={`Copy link to ${view.name}`}
          title="Copy link"
          onClick={() => void copyLink()}
        >
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">
            <path
              d="M5 7l2-2M4.2 5.6L3 6.8a1.7 1.7 0 0 0 2.4 2.4L6.4 8M7.8 6.4L9 5.2A1.7 1.7 0 0 0 6.6 2.8L5.6 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}

/**
 * What a kind looks like: a dot for a board, three lines for a list, three
 * staggered bars for a roadmap. Drawn
 * here rather than taken from an icon set, like the comment bubble on a card.
 */
function ViewKindMark({
  kind,
  on,
  color = "#4b8fbe",
}: {
  kind: ViewKind;
  on: boolean;
  color?: string;
}) {
  if (kind === "board") {
    return <span className={styles.dot6} style={{ background: color, opacity: on ? 1 : 0.45 }} />;
  }
  return (
    <svg
      viewBox="0 0 8 8"
      width="8"
      height="8"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "0 0 8px", opacity: on ? 1 : 0.45 }}
    >
      <path
        d={kind === "roadmap" ? "M0.5 1.5h3.5M2.5 4h4M4 6.5h3.5" : "M0.5 1.5h7M0.5 4h7M0.5 6.5h7"}
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
