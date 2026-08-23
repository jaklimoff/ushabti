"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { GROUPABLE_TYPES } from "@/lib/types";
import { useDismiss } from "@/components/ui/useDismiss";
import { useBoard } from "./store";
import styles from "./board.module.css";

const VIEW_DOTS = ["#3fb0c8", "#6d5bd0", "#2f9e7a", "#d1913a", "#c2557a", "#4b8fbe"];

export function ViewStrip() {
  const { data, view, setViewId, createView } = useBoard();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const groupable = data.properties.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const [groupById, setGroupById] = useState(groupable[0]?.id ?? "");
  const ref = useDismiss<HTMLDivElement>(() => setAdding(false), adding);

  const plusRef = useRef<HTMLButtonElement>(null);
  const [popLeft, setPopLeft] = useState(14);

  const stripRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const taskCount = data.tasks.length;

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

  async function submit() {
    const chosen = groupById || groupable[0]?.id;
    if (!chosen) return;
    const property = data.properties.find((p) => p.id === chosen);
    const title = name.trim() || `By ${property?.name.toLowerCase() ?? "property"}`;
    setName("");
    setAdding(false);
    await createView(title, chosen);
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
              <span
                className={styles.pillDot}
                style={{ background: active ? VIEW_DOTS[i % VIEW_DOTS.length] : "#3f4650" }}
              />
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
          setGroupById(groupable[0]?.id ?? "");
        }}
      >
        +
      </button>

      <div style={{ flex: 1 }} />
      <span className={styles.count}>
        {taskCount} {taskCount === 1 ? "task" : "tasks"}
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
            Rename, regroup or delete a view →
          </Link>
        </div>
      )}
    </div>
  );
}
