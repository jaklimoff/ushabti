"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { GROUPABLE_TYPES, VIEW_KINDS, VIEW_KIND_LABEL, type ViewKind } from "@/lib/types";
import { useDismiss } from "@/components/ui/useDismiss";
import { FilterButton } from "./Filters";
import { useBoard } from "./store";
import styles from "./board.module.css";

const VIEW_DOTS = ["#3fb0c8", "#6d5bd0", "#2f9e7a", "#d1913a", "#c2557a", "#4b8fbe"];

export function ViewStrip({
  filterOpen,
  setFilterOpen,
}: {
  filterOpen: boolean;
  setFilterOpen: (v: boolean) => void;
}) {
  const { data, view, visibleTasks, setViewId, createView } = useBoard();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ViewKind>("board");
  const groupable = data.properties.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const [groupById, setGroupById] = useState(groupable[0]?.id ?? "");
  const ref = useDismiss<HTMLDivElement>(() => setAdding(false), adding);

  const plusRef = useRef<HTMLButtonElement>(null);
  const [popLeft, setPopLeft] = useState(14);

  const stripRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

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

  /* Views past the edge were invisible: the strip scrolls with no scrollbar. */
  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft > 2,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = stripRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, data.views.length]);

  /* Three pills all reading "List" is a mess that costs four lines to stop. */
  function untakenListName(): string {
    const taken = new Set(data.views.map((v) => v.name.toLowerCase()));
    if (!taken.has("list")) return "List";
    for (let n = 2; ; n += 1) if (!taken.has(`list ${n}`)) return `List ${n}`;
  }

  async function submit() {
    const chosen = groupById || groupable[0]?.id || null;
    /* A board is its columns and cannot be made without one. A list groups
       nothing, so it can be made on a project that has no such property —
       which used to make the whole + a dead end. */
    if (kind === "board" && !chosen) return;
    const property = data.properties.find((p) => p.id === chosen);
    const fallback =
      kind === "list" ? untakenListName() : `By ${property?.name.toLowerCase() ?? "property"}`;
    const title = name.trim() || fallback;
    setName("");
    setAdding(false);
    await createView(title, kind, kind === "board" ? chosen : null);
  }

  const fade = [edges.start ? styles.fadeStart : "", edges.end ? styles.fadeEnd : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.views} ref={ref}>
      <div className={`${styles.viewStrip} ${fade}`} ref={stripRef} onScroll={measure}>
        {data.views.map((v, i) => {
          const active = v.id === view?.id;
          return (
            <button
              key={v.id}
              className={`${styles.pill} ${active ? styles.pillActive : ""}`}
              data-testid="view-pill"
              onClick={() => setViewId(v.id)}
            >
              {/* The one place the two kinds sit side by side, so the mark
                  earns its pixels. */}
              {v.kind === "list" ? (
                <ViewKindMark
                  kind="list"
                  on={active}
                  color={active ? VIEW_DOTS[i % VIEW_DOTS.length] : "#3f4650"}
                />
              ) : (
                <span
                  className={styles.pillDot}
                  style={{ background: active ? VIEW_DOTS[i % VIEW_DOTS.length] : "#3f4650" }}
                />
              )}
              {v.name}
            </button>
          );
        })}
      </div>

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

          {kind === "board" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">Columns by</span>
              <div className={styles.chipRow}>
                {groupable.map((property) => (
                  <button
                    key={property.id}
                    className={`${styles.chip} ${groupById === property.id ? styles.chipOn : ""}`}
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
                  Create a select, person or checkbox property first.
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
 * What a kind looks like: a dot for a board, three lines for a list. Drawn
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
        d="M0.5 1.5h7M0.5 4h7M0.5 6.5h7"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
