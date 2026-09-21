"use client";

import { useMemo, useState } from "react";
import type { TaskValue } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmRow";
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
 * value with. **Archive** takes the cards off the board, so the bar itself
 * becomes the question first, the way a column header does. Nothing here is a
 * dialog, and the board behind it never moves out of the way.
 */
export function Selection({ taskOpen }: { taskOpen: boolean }) {
  const { picked } = useBoard();
  /* The bar is unmounted while nothing is picked rather than hidden, so a
     question half asked or a menu left open cannot be waiting underneath the
     next pick. A filter that empties the bar takes both away with it. */
  if (picked.length === 0) return null;
  return <PickBar taskOpen={taskOpen} />;
}

function PickBar({ taskOpen }: { taskOpen: boolean }) {
  const { data, picked, clearPicks, setPickedValue, archivePicked, notify, addOption } = useBoard();
  const sweep = useConfirm();
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
   * Escape puts away one thing, and this is where the order is decided.
   *
   * Four things can be open at once: this panel, an open task, the question
   * Archive asks, and the picks. The panel goes first without being asked —
   * the box in it has the focus, so `useShortcut` leaves the key alone and
   * `useDismiss` takes it. The open task goes next, and its own handler does
   * that; this one stands down while a task is open rather than racing it,
   * because two things put away by one press is a press nobody can undo. The
   * question is nearer the hand than the picks it is about, so it goes before
   * them. The picks are last, which is right: they are the furthest away.
   */
  useShortcut("Escape", () => {
    if (taskOpen) return;
    if (sweep.asking) return sweep.cancel();
    if (picked.length) clearPicks();
  });

  const rows: Row[] = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return data.properties
      .filter((p) => !wanted || p.name.toLowerCase().includes(wanted))
      .map((p) => ({ id: p.id, name: p.name, color: propertyColor(p) }));
  }, [data.properties, query]);

  // Somebody else may have deleted it while the panel is open.
  const property = propertyId ? (data.properties.find((p) => p.id === propertyId) ?? null) : null;

  function pickProperty(id: string | null) {
    setPropertyId(id);
    setDraft(null);
    setQuery("");
    setAt(0);
  }

  const tasks = `${picked.length} ${picked.length === 1 ? "task" : "tasks"}`;

  async function archive() {
    const gone = await archivePicked();
    if (gone > 0) notify(`Archived ${gone} ${gone === 1 ? "task" : "tasks"}.`, "info");
  }

  /*
   * The bar becomes the question, exactly as a column header does. It names
   * the number and stops there: the cards were picked by hand a moment ago,
   * so nobody needs telling what the number counts — and the top bar of a
   * phone has room for a question or for a sentence, not for both.
   */
  if (sweep.asking) {
    return (
      <div
        className={styles.pickBar}
        data-testid="pick-bar"
        role="alertdialog"
        aria-label={`Archive ${tasks}?`}
      >
        <span className={styles.pickCount} data-ask="" data-testid="pick-confirm">
          Archive {tasks}?
        </span>
        <button
          className={styles.pickSet}
          data-danger=""
          data-testid="pick-archive-yes"
          autoFocus
          onClick={() => sweep.confirm(() => void archive())}
        >
          Yes, archive
        </button>
        <button className={styles.pickSet} data-testid="pick-archive-no" onClick={sweep.cancel}>
          Cancel
        </button>
      </div>
    );
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

      {/* Archiving takes the cards off the board, so it asks first and the
          bar itself is where it asks. The Set… menu goes away: one question
          at a time. */}
      <button
        className={styles.pickSet}
        data-danger=""
        data-testid="pick-archive"
        title={`Archive all ${picked.length}`}
        onClick={() => {
          close();
          sweep.ask();
        }}
      >
        Archive
      </button>

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
