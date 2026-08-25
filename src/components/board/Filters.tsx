"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  describeRule,
  hasAnswer,
  isBareOp,
  isSetOp,
  keyColor,
  keyName,
  OPS_FOR_TYPE,
  OP_LABEL,
} from "@/lib/filters";
import {
  NO_VALUE_KEY,
  type FilterOp,
  type FilterRule,
  type MemberDTO,
  type PropertyDTO,
  type PropertyType,
} from "@/lib/types";
import { useDismiss } from "@/components/ui/useDismiss";
import { useBoard } from "./store";
import styles from "./board.module.css";

/* ------------------------------------------------------------------ */
/* The parts a rule is made of                                         */
/* ------------------------------------------------------------------ */

/**
 * Everything a rule about this property may name, in the order the board shows
 * it. "Nothing yet" is one of them rather than an operator of its own, because
 * "Todo, or nothing yet" is one question, and two rules cannot ask it: every
 * rule has to pass.
 */
function keysFor(property: PropertyDTO, members: MemberDTO[]): string[] {
  if (property.type === "person") return [...members.map((m) => m.id), NO_VALUE_KEY];
  if (property.type === "checkbox") return ["true", "false"];
  return [...property.options.map((o) => o.id), NO_VALUE_KEY];
}

/**
 * A new rule carries the question and no answer. It used to arrive with the
 * first option already chosen, which meant picking "Priority" hid most of the
 * board before anybody had said which priority they meant. The board cannot
 * know the answer, so it does not guess one.
 */
function emptyRule(property: PropertyDTO): FilterRule {
  const op = OPS_FOR_TYPE[property.type][0];
  return isSetOp(op)
    ? { propertyId: property.id, op, values: [] }
    : { propertyId: property.id, op, text: "" };
}

/** What the box asks for once a property has been picked. */
const ASK: Record<PropertyType, string> = {
  select: "Which value?",
  multi_select: "Which value?",
  person: "Who?",
  checkbox: "Which value?",
  text: "What words?",
  number: "What number?",
  date: "Which date?",
};

/** The dot beside a property in the list. */
function propertyColor(property: PropertyDTO): string {
  return property.options[0]?.color ?? "#4b8fbe";
}

/* ------------------------------------------------------------------ */
/* A list with a highlight the box drives                              */
/* ------------------------------------------------------------------ */

type Row = { id: string; name: string; color: string; on?: boolean; note?: string };

/**
 * The rows are a listbox and the box keeps the focus, so the panel is one tab
 * stop like the board is. That is why the highlight is `aria-activedescendant`
 * and not focus, and why a row cannot be a button.
 */
function Rows({
  rows,
  at,
  listId,
  empty,
  onPick,
}: {
  rows: Row[];
  at: number;
  listId: string;
  empty: string;
  onPick: (row: Row) => void;
}) {
  if (rows.length === 0) return <span className={styles.filterNote}>{empty}</span>;

  return (
    <div className={styles.filterList} role="listbox" id={listId}>
      {rows.map((row, i) => (
        <div
          key={row.id}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={!!row.on}
          className={`${styles.filterItem} ${row.on ? styles.filterItemOn : ""} ${
            i === at ? styles.filterItemAt : ""
          }`}
          // The box must keep the focus, so the press must not move it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(row)}
        >
          <span
            className={styles.dot6}
            style={{ background: row.color, opacity: row.on === false ? 0.45 : 1 }}
          />
          {row.name}
          <span style={{ flex: 1 }} />
          {row.note && <span className={styles.filterRowNote}>{row.note}</span>}
          {row.on !== undefined && (
            <span className={styles.filterTick} style={{ opacity: row.on ? 1 : 0 }}>
              ✓
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Where an arrow key takes the highlight. It wraps; a short list is a ring. */
function step(at: number, count: number, way: number): number {
  if (count === 0) return 0;
  return (at + way + count) % count;
}

/* ------------------------------------------------------------------ */
/* Asking one property something                                       */
/* ------------------------------------------------------------------ */

/**
 * The second half of the panel, and the whole of a chip's own panel: an
 * operator, and the answer. It writes a rule only once the rule has an answer,
 * and takes the rule away again when the answer is taken back.
 */
function Ask({
  property,
  rule,
  members,
  onChange,
  onBack,
  onClose,
}: {
  property: PropertyDTO;
  rule: FilterRule;
  members: MemberDTO[];
  onChange: (rule: FilterRule) => void;
  /** Absent in a chip's panel: there is nowhere to go back to. */
  onBack?: () => void;
  onClose: () => void;
}) {
  const ops = OPS_FOR_TYPE[property.type];
  const set = isSetOp(rule.op);
  const bare = isBareOp(rule.op);
  const [query, setQuery] = useState(bare || set ? "" : (rule.text ?? ""));
  const [at, setAt] = useState(0);

  // A fresh [] on every render would rebuild the rows on every keystroke.
  const chosen = useMemo(() => rule.values ?? [], [rule.values]);
  const rows: Row[] = useMemo(() => {
    if (!set) return [];
    const wanted = query.trim().toLowerCase();
    return keysFor(property, members)
      .map((key) => ({
        id: key,
        name: keyName(key, property, members),
        color: keyColor(key, property, members),
        on: chosen.includes(key),
      }))
      .filter((row) => !wanted || row.name.toLowerCase().includes(wanted));
  }, [chosen, members, property, query, set]);

  /* Changing the operator keeps the answer it can carry and drops what it
     cannot. It never invents one. */
  function setOp(op: FilterOp) {
    if (isBareOp(op)) return onChange({ propertyId: property.id, op });
    if (isSetOp(op)) {
      return onChange({ propertyId: property.id, op, values: set ? chosen : [] });
    }
    onChange({ propertyId: property.id, op, text: set ? "" : (rule.text ?? "") });
  }

  function toggle(key: string) {
    onChange({
      ...rule,
      values: chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key],
    });
    // A tick leaves the list where it is, so the next one is where you left it.
    setQuery("");
  }

  /** The box is the answer for a text, number or date rule. */
  function commitText() {
    if (set || bare) return;
    const text = query.trim();
    if ((rule.text ?? "") === text) return;
    onChange({ ...rule, text });
  }

  /*
   * A field saves on blur, and this one has three ways to lose the focus that
   * do not raise a blur: Escape, a click outside, and the ‹ that goes back.
   * All three unmount this, so what was typed is saved on the way out. Without
   * it, typing a word and clicking the board throws the word away — the one
   * thing the rest of this product never does.
   */
  const latest = useRef({ query, rule, set, bare, onChange });
  useEffect(() => {
    latest.current = { query, rule, set, bare, onChange };
  });
  useEffect(
    () => () => {
      const now = latest.current;
      if (now.set || now.bare) return;
      const text = now.query.trim();
      if ((now.rule.text ?? "") !== text) now.onChange({ ...now.rule, text });
    },
    [],
  );

  const listId = `filter-values-${property.id}`;

  return (
    <>
      <div className={styles.askHead}>
        {onBack ? (
          <button
            className={styles.askTag}
            title="Pick another property"
            aria-label={`Filtering by ${property.name}. Pick another property`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onBack}
          >
            <span aria-hidden>‹</span>
            {property.name}
          </button>
        ) : (
          <span className={`${styles.askTag} ${styles.askTagFlat}`}>{property.name}</span>
        )}
        <input
          className={styles.askBox}
          autoFocus
          role="combobox"
          aria-expanded={set}
          aria-controls={set ? listId : undefined}
          aria-activedescendant={set && rows.length ? `${listId}-${at}` : undefined}
          aria-label={
            set ? `Find a value of ${property.name}` : `What ${property.name} ${OP_LABEL[rule.op]}`
          }
          type={property.type === "date" && !set && !bare ? "date" : "text"}
          inputMode={property.type === "number" && !set ? "decimal" : undefined}
          data-testid="filter-box"
          value={query}
          placeholder={bare ? "" : ASK[property.type]}
          readOnly={bare}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onBlur={commitText}
          onKeyDown={(e) => {
            /* Escape puts the panel away. There is no cancel anywhere in this
               product, so it saves what was typed on the way, like a blur. */
            if (e.key === "Escape") return;
            if (e.key === "Backspace" && query === "" && onBack) {
              e.preventDefault();
              return onBack();
            }
            if (!set) {
              if (e.key === "Enter") {
                e.preventDefault();
                commitText();
                onClose();
              }
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              return setAt((n) => step(n, rows.length, 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              return setAt((n) => step(n, rows.length, -1));
            }
            if (e.key === "Enter" && rows[at]) {
              e.preventDefault();
              toggle(rows[at].id);
            }
          }}
        />
      </div>

      {ops.length > 1 && (
        <div className={styles.chipRow}>
          {ops.map((op) => (
            <button
              key={op}
              className={`${styles.chip} ${rule.op === op ? styles.chipOn : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOp(op)}
            >
              {OP_LABEL[op]}
            </button>
          ))}
        </div>
      )}

      {set && (
        <Rows
          rows={rows}
          at={at}
          listId={listId}
          empty="Nothing by that name."
          onPick={(row) => toggle(row.id)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The trigger in the view strip                                       */
/* ------------------------------------------------------------------ */

/**
 * Adding a filter is two answers in one panel that does not move: which
 * property, then what about it. The rule reaches the view on the first answer
 * and not before, so nobody else on the board sees a half-made question.
 */
export function FilterButton({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { data, filters, setFilters } = useBoard();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  /** Where in the view the rule went, or null while it has no answer yet. */
  const [slot, setSlot] = useState<number | null>(null);
  const [draft, setDraft] = useState<FilterRule | null>(null);

  function reset() {
    setPickedId(null);
    setQuery("");
    setAt(0);
    setSlot(null);
    setDraft(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  const ref = useDismiss<HTMLDivElement>(close, open);

  const count = filters.rules.length;
  // The property may have been deleted by somebody else while the panel is
  // open, in which case there is nothing left to ask about.
  const picked = pickedId ? (data.properties.find((p) => p.id === pickedId) ?? null) : null;
  const rule = picked ? ((slot !== null ? filters.rules[slot] : null) ?? draft) : null;

  const summary = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of filters.rules) {
      const property = data.properties.find((p) => p.id === r.propertyId);
      if (property) map.set(r.propertyId, describeRule(r, property, data.members));
    }
    return map;
  }, [data.members, data.properties, filters.rules]);

  const rows: Row[] = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return data.properties
      .filter((p) => !wanted || p.name.toLowerCase().includes(wanted))
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: propertyColor(p),
        note: summary.get(p.id),
      }));
  }, [data.properties, query, summary]);

  function pick(propertyId: string) {
    const property = data.properties.find((p) => p.id === propertyId);
    if (!property) return;
    /*
     * A second "is" rule about one property could only narrow the first, so
     * picking it again opens the rule that is already there. A date is left
     * alone: "after March" and "before June" are two rules on purpose.
     */
    const found = filters.rules.findIndex((r) => r.propertyId === property.id && isSetOp(r.op));
    setSlot(found >= 0 ? found : null);
    setDraft(found >= 0 ? filters.rules[found] : emptyRule(property));
    setPickedId(property.id);
    setQuery("");
    setAt(0);
  }

  /* The one place a rule arrives, changes or goes. */
  function change(next: FilterRule) {
    setDraft(next);
    if (hasAnswer(next)) {
      if (slot === null) {
        setSlot(filters.rules.length);
        void setFilters([...filters.rules, next]);
      } else {
        void setFilters(filters.rules.map((r, i) => (i === slot ? next : r)));
      }
      return;
    }
    // The answer was taken back, so the rule goes with it.
    if (slot !== null) {
      void setFilters(filters.rules.filter((_, i) => i !== slot));
      setSlot(null);
    }
  }

  return (
    <div className={styles.filterAnchor} ref={ref}>
      <button
        className={`${styles.pill} ${count ? styles.filterOn : ""}`}
        data-testid="filter-button"
        aria-expanded={open}
        title={count ? "Change what this view shows" : "Show only some of the tasks"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className={styles.filterMark} aria-hidden />
        Filter{count ? ` ${count}` : ""}
      </button>

      {open && (
        <div className={`${styles.popover} ${styles.filterPop}`} data-testid="filter-menu">
          {picked && rule ? (
            <Ask
              key={picked.id}
              property={picked}
              rule={rule}
              members={data.members}
              onChange={change}
              onBack={reset}
              onClose={close}
            />
          ) : (
            <>
              <span className="label">Show only tasks where</span>
              {/* The same box in the same place as step two, so picking a
                  property reads as the box moving on rather than swapping. */}
              <div className={styles.askHead}>
                <input
                  className={styles.askBox}
                  autoFocus
                  role="combobox"
                  aria-expanded
                  aria-controls="filter-properties"
                  aria-activedescendant={rows.length ? `filter-properties-${at}` : undefined}
                  aria-label="Find a property to filter by"
                  data-testid="filter-search"
                  placeholder="Which property?"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setAt(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      return setAt((n) => step(n, rows.length, 1));
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      return setAt((n) => step(n, rows.length, -1));
                    }
                    if (e.key === "Enter" && rows[at]) {
                      e.preventDefault();
                      pick(rows[at].id);
                    }
                  }}
                />
              </div>
              <Rows
                rows={rows}
                at={at}
                listId="filter-properties"
                empty="No property by that name."
                onPick={(row) => pick(row.id)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The chips under the strip                                           */
/* ------------------------------------------------------------------ */

/**
 * A filtered board says so on its own line, and the line is the control. It
 * exists while the view has a rule, and also while the panel is open, so the
 * first answer does not push the board down a line under an open panel.
 */
export function FilterChips({ panelOpen }: { panelOpen: boolean }) {
  const { data, filters, setFilters } = useBoard();
  if (filters.rules.length === 0 && !panelOpen) return null;

  function write(rules: FilterRule[]) {
    void setFilters(rules);
  }

  return (
    <div className={styles.filterRow} data-testid="filter-row">
      {filters.rules.map((rule, i) => {
        const property = data.properties.find((p) => p.id === rule.propertyId);
        if (!property) return null;
        return (
          <Chip
            key={`${rule.propertyId}-${i}`}
            rule={rule}
            property={property}
            members={data.members}
            onChange={(next) =>
              write(
                hasAnswer(next)
                  ? filters.rules.map((r, at) => (at === i ? next : r))
                  : filters.rules.filter((_, at) => at !== i),
              )
            }
            onRemove={() => write(filters.rules.filter((_, at) => at !== i))}
          />
        );
      })}
      {filters.rules.length > 0 && (
        <button className={styles.filterClear} data-testid="filter-clear" onClick={() => write([])}>
          Clear
        </button>
      )}
    </div>
  );
}

function Chip({
  rule,
  property,
  members,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  property: PropertyDTO;
  members: MemberDTO[];
  onChange: (rule: FilterRule) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  const said = describeRule(rule, property, members);

  return (
    <div className={styles.filterAnchor} ref={ref}>
      <span className={`${styles.filterChip} ${open ? styles.filterChipOpen : ""}`}>
        <button
          className={styles.filterChipBody}
          data-testid="filter-chip"
          aria-expanded={open}
          title="Change this filter"
          onClick={() => setOpen((v) => !v)}
        >
          {said}
        </button>
        <button
          className={styles.filterChipX}
          aria-label={`Remove the filter ${said}`}
          title="Remove"
          onClick={onRemove}
        >
          ✕
        </button>
      </span>

      {open && (
        <div className={`${styles.popover} ${styles.filterPop}`} data-testid="filter-editor">
          <Ask
            property={property}
            rule={rule}
            members={members}
            onChange={onChange}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
