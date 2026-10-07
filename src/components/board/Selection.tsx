"use client";

import { useMemo, useRef, useState } from "react";
import { canSetOnMany, type Change } from "@/lib/bulk";
import type { PropertyDTO, TaskValue } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmRow";
import { useDismiss } from "@/components/ui/useDismiss";
import { AskBox, propertyColor, Rows, type Row } from "./Ask";
import { PropertyControl } from "./controls/PropertyControl";
import { useShortcut } from "./keys";
import { useBoard } from "./store";
import styles from "./board.module.css";
import { hasOptions } from "@/lib/types";
import { pickedAsked, pickedDrops } from "@/lib/when";

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
  /* A set that hides values on the picked cards asks first, with the counts.
     The bar is where it asks, as it is for Archive. */
  const [asking, setAsking] = useState<{
    propertyId: string;
    value: TaskValue;
    question: string;
    /** The picks the question counted. */
    picks: string;
  } | null>(null);
  /* Yes sets the picks of the moment it is pressed, so a question that
     counted other picks goes: a card picked under it would lose values
     nobody named. */
  const picks = [...picked].sort().join(" ");
  if (asking && asking.picks !== picks) setAsking(null);
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
    if (asking) return setAsking(null);
    if (picked.length) clearPicks();
  });

  const rows: Row[] = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return data.properties
      .filter((p) => canSetOnMany(p.type))
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
  if (asking) {
    return (
      <div
        className={`${styles.pickBar} ${styles.pickAsking}`}
        data-testid="pick-bar"
        role="alertdialog"
        aria-label={asking.question}
      >
        <span className={styles.pickCount} data-ask="" data-testid="pick-set-confirm">
          {asking.question}
        </span>
        <button
          className={styles.pickSet}
          data-danger=""
          data-testid="pick-set-yes"
          autoFocus
          onClick={() => {
            setAsking(null);
            void setPickedValue(asking.propertyId, asking.value);
          }}
        >
          Yes, change
        </button>
        <button
          className={styles.pickSet}
          data-testid="pick-set-no"
          onClick={() => setAsking(null)}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (sweep.asking) {
    return (
      <div
        className={`${styles.pickBar} ${styles.pickAsking}`}
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
                    title="Choose another property"
                    aria-label={`Setting ${property.name}. Choose another property`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickProperty(null)}
                  >
                    <span aria-hidden>‹</span>
                    {property.name}
                  </button>
                </div>
                {property.type === "multi_select" ? (
                  <OneOption property={property} />
                ) : (
                  <>
                    <div className={styles.pickControl}>
                      <PropertyControl
                        property={property}
                        value={draft}
                        members={data.members}
                        today={data.today}
                        onChange={(value: TaskValue) => {
                          const wanted = new Set(picked);
                          const cards = data.tasks.filter((t) => wanted.has(t.id));
                          const drops = pickedDrops(cards, data.properties, property.id, value);
                          if (drops.values > 0) {
                            close();
                            setAsking({
                              propertyId: property.id,
                              value,
                              question: pickedAsked(property, value, picked.length, drops),
                              picks,
                            });
                            return;
                          }
                          setDraft(value);
                          void setPickedValue(property.id, value);
                        }}
                        onAddOption={
                          hasOptions(property.type)
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
                )}
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
        aria-label="Clear selection"
        title="Clear selection (Escape)"
        onClick={clearPicks}
      >
        ✕
      </button>
    </div>
  );
}

/*
 * A multi-select is changed one option at a time, never set whole.
 *
 * Each picked task has a list of its own, so one list sent to all of them
 * replaces every one of those lists: Bug set on thirty tasks took every other
 * label off all thirty. So the bar asks which way — on or off — and which
 * option, and says under the list what the highlighted one will do before a
 * press does it. A row says how many of the picks already carry it.
 */
function OneOption({ property }: { property: PropertyDTO }) {
  const { data, picked, setPickedValue } = useBoard();
  const [change, setChange] = useState<Change>("add");
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  // A press while the last one is out would send a second change on top of it.
  const out = useRef(false);

  const cards = useMemo(() => {
    const wanted = new Set(picked);
    return data.tasks.filter((t) => wanted.has(t.id));
  }, [data.tasks, picked]);

  // How many of the picks carry each option, for the rows and the sentence.
  const carrying = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of cards) {
      const v = t.values[property.id];
      if (!Array.isArray(v)) continue;
      for (const id of v) count.set(id, (count.get(id) ?? 0) + 1);
    }
    return count;
  }, [cards, property.id]);

  const n = cards.length;
  const rows: Row[] = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return property.options
      .filter((o) => !wanted || o.name.toLowerCase().includes(wanted))
      .map((o) => ({
        id: o.id,
        name: o.name,
        color: o.color,
        note: `${carrying.get(o.id) ?? 0} of ${n}`,
      }));
  }, [property.options, query, carrying, n]);

  async function pick(row: Row) {
    if (out.current) return;
    out.current = true;
    try {
      await setPickedValue(property.id, row.id, change);
    } finally {
      out.current = false;
    }
  }

  const row = rows[at];
  const said = row
    ? changeSaid(change, row.name, property.name, carrying.get(row.id) ?? 0, n)
    : `Pick the ${property.name} option to ${change === "add" ? "add" : "take off"}.`;

  return (
    <>
      <div className={styles.chipRow} role="group" aria-label={`Add or take off ${property.name}`}>
        {(["add", "remove"] as const).map((way) => (
          <button
            key={way}
            className={`${styles.chip} ${change === way ? styles.chipOn : ""}`}
            aria-pressed={change === way}
            data-testid={`pick-${way}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setChange(way)}
          >
            {way === "add" ? "Add" : "Take off"}
          </button>
        ))}
      </div>
      <AskBox
        query={query}
        onQuery={setQuery}
        rows={rows}
        at={at}
        setAt={setAt}
        onPick={(r) => void pick(r)}
        listId="pick-options"
        label={`Find the ${property.name} option`}
        placeholder="Which option?"
        testId="pick-option-search"
      />
      <Rows
        rows={rows}
        at={at}
        listId="pick-options"
        empty="No option by that name."
        onPick={(r) => void pick(r)}
      />
      <span className={styles.filterNote} data-testid="pick-note" aria-live="polite">
        {said}
      </span>
    </>
  );
}

/** What a press on one option will do to the picks, said before it does it. */
function changeSaid(change: Change, option: string, name: string, have: number, n: number) {
  const tasks = (count: number) => (count === 1 ? "1 task" : `${count} tasks`);
  if (change === "add") {
    if (have === n)
      return n === 1 ? `It has ${option} already.` : `All ${n} have ${option} already.`;
    return `Adds ${option} to ${tasks(n - have)}. Their other ${name} stay.`;
  }
  if (have === 0) return n === 1 ? `It has no ${option}.` : `None of the ${n} has ${option}.`;
  return `Takes ${option} off ${tasks(have)}. Their other ${name} stay.`;
}
