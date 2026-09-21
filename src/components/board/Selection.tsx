"use client";

import { useMemo, useState } from "react";
import type { TaskValue } from "@/lib/types";
import { useDismiss } from "@/components/ui/useDismiss";
import { AskBox, propertyColor, Rows, type Row } from "./Ask";
import { PropertyControl } from "./controls/PropertyControl";
import { useShortcut } from "./keys";
import { useBoard } from "./store";
import styles from "./board.module.css";

/**
 * What is picked, and the one thing you can do to all of it.
 *
 * It sits in the top bar beside the search box, and only while something is
 * picked. Not in the view strip: the strip holds what belongs to a view, and a
 * handful of cards picked for a moment belongs to nobody but the person who
 * picked them.
 *
 * **Set…** is the filter's own two-step question — which property, then what
 * about it — and the second step is the control the task panel already sets a
 * value with. Nothing here is a dialog, and the board behind it never moves
 * out of the way.
 */
export function Selection() {
  const { data, picked, clearPicks, setPickedValue, addOption } = useBoard();
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  /* What was set, so the control says what the cards now carry. It starts
     empty because the cards may each have carried something different. */
  const [draft, setDraft] = useState<TaskValue>(null);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);

  function close() {
    setOpen(false);
    setPropertyId(null);
    setDraft(null);
    setQuery("");
    setAt(0);
  }

  const ref = useDismiss<HTMLDivElement>(close, open);

  /*
   * Escape ends the picking. While the panel is open the box inside it has the
   * focus, so this does not fire — `useShortcut` leaves a field alone — and
   * `useDismiss` closes the panel instead. Escape always puts away one thing.
   */
  useShortcut("Escape", () => {
    if (picked.length) clearPicks();
  });

  const rows: Row[] = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return data.properties
      .filter((p) => !wanted || p.name.toLowerCase().includes(wanted))
      .map((p) => ({ id: p.id, name: p.name, color: propertyColor(p) }));
  }, [data.properties, query]);

  if (picked.length === 0) return null;

  // Somebody else may have deleted it while the panel is open.
  const property = propertyId ? (data.properties.find((p) => p.id === propertyId) ?? null) : null;

  function pickProperty(id: string | null) {
    setPropertyId(id);
    setDraft(null);
    setQuery("");
    setAt(0);
  }

  return (
    <div className={styles.pickBar} data-testid="pick-bar" role="status">
      <span className={styles.pickCount} data-testid="pick-count">
        {picked.length} selected
      </span>

      <div className={styles.filterAnchor} ref={ref}>
        <button
          className={styles.pickSet}
          data-testid="pick-set"
          aria-expanded={open}
          title={`Set one property on all ${picked.length}`}
          onClick={() => (open ? close() : setOpen(true))}
        >
          Set…
        </button>

        {open && (
          <div className={`${styles.popover} ${styles.filterPop}`} data-testid="pick-menu">
            {property ? (
              <>
                <div className={styles.askHead}>
                  <button
                    className={styles.askTag}
                    title="Pick another property"
                    aria-label={`Setting ${property.name}. Pick another property`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickProperty(null)}
                  >
                    <span aria-hidden>‹</span>
                    {property.name}
                  </button>
                </div>
                <div className={styles.pickControl}>
                  <PropertyControl
                    property={property}
                    value={draft}
                    members={data.members}
                    onChange={(value: TaskValue) => {
                      setDraft(value);
                      void setPickedValue(property.id, value);
                    }}
                    onAddOption={
                      property.type === "select" || property.type === "multi_select"
                        ? (name) => addOption(property.id, name)
                        : undefined
                    }
                  />
                </div>
                {/* It says what it will do before it does it, exactly as the
                    composer says what a filter will put on a new task. */}
                <span className={styles.filterNote}>
                  {picked.length === 1
                    ? "It goes on the one task."
                    : `It goes on all ${picked.length} tasks.`}
                </span>
              </>
            ) : (
              <>
                <span className="label">Set one property on all of them</span>
                <AskBox
                  query={query}
                  onQuery={setQuery}
                  rows={rows}
                  at={at}
                  setAt={setAt}
                  onPick={(row) => pickProperty(row.id)}
                  listId="pick-properties"
                  label="Find the property to set"
                  placeholder="Which property?"
                  testId="pick-search"
                />
                <Rows
                  rows={rows}
                  at={at}
                  listId="pick-properties"
                  empty="No property by that name."
                  onPick={(row) => pickProperty(row.id)}
                />
              </>
            )}
          </div>
        )}
      </div>

      <button
        className={styles.pickClear}
        data-testid="pick-clear"
        aria-label="Leave every task out"
        title="Leave every task out (Escape)"
        onClick={clearPicks}
      >
        ✕
      </button>
    </div>
  );
}
