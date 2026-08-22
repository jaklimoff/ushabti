"use client";

import { useState } from "react";
import { GROUPABLE_TYPES } from "@/lib/types";
import { useDismiss } from "@/components/ui/useDismiss";
import { useBoard } from "./store";
import styles from "./board.module.css";

const VIEW_DOTS = ["#3fb0c8", "#6d5bd0", "#2f9e7a", "#d1913a", "#c2557a", "#4b8fbe"];

export function ViewStrip() {
  const { data, view, setViewId, createView, deleteView } = useBoard();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const groupable = data.properties.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const [groupById, setGroupById] = useState(groupable[0]?.id ?? "");
  const ref = useDismiss<HTMLDivElement>(() => setAdding(false), adding);

  const taskCount = data.tasks.length;

  async function submit() {
    const chosen = groupById || groupable[0]?.id;
    if (!chosen) return;
    const property = data.properties.find((p) => p.id === chosen);
    const title = name.trim() || `By ${property?.name.toLowerCase() ?? "property"}`;
    setName("");
    setAdding(false);
    await createView(title, chosen);
  }

  return (
    <div className={styles.views} ref={ref}>
      <div className={styles.viewStrip}>
        {data.views.map((v, i) => {
          const active = v.id === view?.id;
          return (
            <button
              key={v.id}
              className={`${styles.pill} ${active ? styles.pillActive : ""}`}
              onClick={() => setViewId(v.id)}
            >
              <span
                className={styles.pillDot}
                style={{ background: active ? VIEW_DOTS[i % VIEW_DOTS.length] : "#3f4650" }}
              />
              {v.name}
              {!v.isDefault && active && (
                <span
                  className={styles.pillClose}
                  role="button"
                  tabIndex={0}
                  aria-label={`Delete the view ${v.name}`}
                  title="Delete this view"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteView(v.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      void deleteView(v.id);
                    }
                  }}
                >
                  ✕
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        className={styles.plus}
        aria-label="New view"
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
        <div className={styles.popover}>
          <span className="label">New view</span>
          <input
            className={styles.popInput}
            autoFocus
            value={name}
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
        </div>
      )}
    </div>
  );
}
