"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  asksAbout,
  BLOCKED_KEY,
  clashSaid,
  describeRule,
  filterProperties,
  hasAnswer,
  isBareOp,
  isSetOp,
  isWindowOp,
  keyColor,
  keyName,
  ME_KEY,
  OPS_FOR_TYPE,
  OP_LABEL,
} from "@/lib/filters";
import { DATE_WINDOWS, DATE_WINDOW_NAME } from "@/lib/day";
import { canSort, nextSort, sortLabel } from "@/lib/sort";
import { listColumns } from "@/lib/list-view";
import type { CardItem } from "@/lib/card-view";
import type { LeaveSend } from "@/lib/leave";
import {
  NO_VALUE_KEY,
  type FilterOp,
  type FilterRule,
  type MemberDTO,
  type PropertyDTO,
  type PropertyType,
  type SortDirection,
  type ViewSort,
} from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmRow";
import { useDismiss } from "@/components/ui/useDismiss";
import { useSaveOnLeave } from "@/components/ui/useSaveOnLeave";
import { AskBox, BUILTIN_DOT, propertyColor, Rows, step, type Row } from "./Ask";
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
  /* Me comes first: it is the one a shared "My tasks" view is made of, and it
     means whoever reads the view, not the person who picked it. */
  if (property.type === "person") return [ME_KEY, ...members.map((m) => m.id), NO_VALUE_KEY];
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

/** The dot beside a window of days. A window is not a value of anything. */
const WINDOW_DOT = "#6b7280";

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

/*
 * What a write of these rules would send.
 *
 * The box saves on blur, and a tab closed on it sends no blur, so the box
 * says here what the write it owes would have been; see `useSaveOnLeave`.
 * The team's rules are patched onto the view and mine are put on my lens,
 * which is the only difference between the two.
 */
function viewSend(viewId: string, rules: FilterRule[]): LeaveSend {
  return { method: "PATCH", url: `/api/views/${viewId}`, body: { filters: { rules } } };
}

function lensSend(viewId: string, rules: FilterRule[]): LeaveSend {
  return { method: "PUT", url: `/api/views/${viewId}/lens`, body: { filters: { rules } } };
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
  owed,
  onBack,
  onClose,
}: {
  property: PropertyDTO;
  rule: FilterRule;
  members: MemberDTO[];
  onChange: (rule: FilterRule) => void;
  /** The request this box would send for that rule, for a tab that is going. */
  owed: (rule: FilterRule) => LeaveSend | null;
  /** Absent in a chip's panel: there is nowhere to go back to. */
  onBack?: () => void;
  onClose: () => void;
}) {
  const ops = OPS_FOR_TYPE[property.type];
  const set = isSetOp(rule.op);
  const bare = isBareOp(rule.op);
  /* A window is one word from a closed list, so the box searches the list
     instead of holding the answer, exactly as it does for a set. */
  const win = isWindowOp(rule.op);
  const [query, setQuery] = useState(bare || set || win ? "" : (rule.text ?? ""));
  const [at, setAt] = useState(0);
  /* Whether somebody typed in the box since its last save. The box is filled
     in once and goes stale the moment another tab changes the rule, so a box
     nobody typed in has nothing to save and would put the old words back. */
  const [typed, setTyped] = useState(false);

  // A fresh [] on every render would rebuild the rows on every keystroke.
  const chosen = useMemo(() => rule.values ?? [], [rule.values]);
  const rows: Row[] = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (win) {
      return DATE_WINDOWS.map((word) => ({
        id: word,
        name: DATE_WINDOW_NAME[word],
        color: WINDOW_DOT,
        on: rule.text === word,
      })).filter((row) => !wanted || row.name.toLowerCase().includes(wanted));
    }
    if (!set) return [];
    return keysFor(property, members)
      .map((key) => ({
        id: key,
        name: keyName(key, property, members),
        color: keyColor(key, property, members),
        on: chosen.includes(key),
      }))
      .filter((row) => !wanted || row.name.toLowerCase().includes(wanted));
  }, [chosen, members, property, query, rule.text, set, win]);

  /* Changing the operator keeps the answer it can carry and drops what it
     cannot. It never invents one. */
  function setOp(op: FilterOp) {
    /* The box means one thing for a window and another for a day, so what was
       typed for one is not an answer — or even a search — for the other. */
    if (isWindowOp(op) !== win) setQuery("");
    if (isBareOp(op)) return onChange({ propertyId: property.id, op });
    if (isSetOp(op)) {
      return onChange({ propertyId: property.id, op, values: set ? chosen : [] });
    }
    /* A window is a word and a date is a day. Text moves only between
       operators that read it the same way. */
    const keeps = !set && isWindowOp(op) === win;
    onChange({ propertyId: property.id, op, text: keeps ? (rule.text ?? "") : "" });
  }

  /*
   * One window is the whole answer, so a pick replaces rather than adds. The
   * panel stays open, as the value list does, because changing your mind is
   * the next press and not a second trip.
   */
  function pickWindow(word: string) {
    onChange({ propertyId: property.id, op: rule.op, text: word });
    setQuery("");
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
    if (set || bare || win) return;
    setTyped(false);
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
  const latest = useRef({ query, rule, set, bare, win, typed, onChange });
  useEffect(() => {
    latest.current = { query, rule, set, bare, win, typed, onChange };
  });
  useEffect(
    () => () => {
      const now = latest.current;
      if (now.set || now.bare || now.win || !now.typed) return;
      const text = now.query.trim();
      if ((now.rule.text ?? "") !== text) now.onChange({ ...now.rule, text });
    },
    [],
  );

  /* The fourth way to lose the focus is the tab itself, and that one unmounts
     nothing. The same words go out on the way off the page instead. */
  useSaveOnLeave(() => {
    if (set || bare || win || !typed) return null;
    const text = query.trim();
    if ((rule.text ?? "") === text) return null;
    return owed({ ...rule, text });
  });

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
          aria-expanded={set || win}
          aria-controls={set || win ? listId : undefined}
          aria-activedescendant={(set || win) && rows.length ? `${listId}-${at}` : undefined}
          aria-label={
            win
              ? `Find a window of days for ${property.name}`
              : set
                ? `Find a value of ${property.name}`
                : `What ${property.name} ${OP_LABEL[rule.op]}`
          }
          /* A date box cannot hold a search word, and a window is searched
             for by name. */
          type={property.type === "date" && !set && !bare && !win ? "date" : "text"}
          inputMode={property.type === "number" && !set ? "decimal" : undefined}
          data-testid="filter-box"
          value={query}
          placeholder={bare ? "" : win ? "Which days?" : ASK[property.type]}
          readOnly={bare}
          onChange={(e) => {
            setQuery(e.target.value);
            setTyped(true);
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
            if (!set && !win) {
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
              if (win) return pickWindow(rows[at].id);
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

      {/* The third row of the picker: the words a window is made of. It is
          the same listbox the set operators use, so the panel is one thing to
          learn however the question is shaped. */}
      {win && (
        <Rows
          rows={rows}
          at={at}
          listId={listId}
          empty="No window by that name."
          onPick={(row) => pickWindow(row.id)}
        />
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
  /* A rule somebody adds here is their own. The view's rules are the team's
     answer to what this board is about, and a member narrowing their screen
     must not re-answer it for everybody. The way onto the view is one press in
     the strip, and it is named. */
  const { data, view, filters, viewFilters, lens, setLens } = useBoard();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  /** Where in the view the rule went, or null while it has no answer yet. */
  const [slot, setSlot] = useState<number | null>(null);
  const [draft, setDraft] = useState<FilterRule | null>(null);
  /** The line that says why a property was not taken, or null. */
  const [refused, setRefused] = useState<string | null>(null);

  function reset() {
    setPickedId(null);
    setQuery("");
    setAt(0);
    setSlot(null);
    setDraft(null);
    setRefused(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  const ref = useDismiss<HTMLDivElement>(close, open);

  // Every rule that hides a card on this screen, the view's and mine alike:
  // the pill says what the board is doing, not who asked for it.
  const count = filters.rules.length;
  // The property may have been deleted by somebody else while the panel is
  // open, in which case there is nothing left to ask about.
  /* The project's properties, and the one word that is not one. A link is not
     a field, so "Blocked" has no property to be — it is a fixed word, the way
     a card's key is a fixed row. */
  const askable = useMemo(() => filterProperties(data.properties), [data.properties]);
  const picked = pickedId ? (askable.find((p) => p.id === pickedId) ?? null) : null;
  const rule = picked ? ((slot !== null ? lens.rules[slot] : null) ?? draft) : null;

  const summary = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of filters.rules) {
      const property = askable.find((p) => p.id === r.propertyId);
      if (property) map.set(r.propertyId, describeRule(r, property, data.members));
    }
    return map;
  }, [askable, data.members, filters.rules]);

  const rows: Row[] = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return askable
      .filter((p) => !wanted || p.name.toLowerCase().includes(wanted))
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.id === BLOCKED_KEY ? BUILTIN_DOT : propertyColor(p),
        note: summary.get(p.id),
      }));
  }, [askable, query, summary]);

  function pick(propertyId: string) {
    const property = askable.find((p) => p.id === propertyId);
    if (!property) return;
    /*
     * The view already asks about this property, and a rule of mine may only
     * narrow. A second rule beside it would empty the board with two chips
     * that fight each other, so the panel says so and writes nothing. The
     * view's rule is not mine to change from here: the ✕ on its own chip is
     * the way out, and it asks for everybody before it goes.
     */
    if (asksAbout(viewFilters, property.id)) {
      setRefused(clashSaid(property));
      return;
    }
    /*
     * A second "is" rule about one property could only narrow the first, so
     * picking it again opens the rule that is already there. A date is left
     * alone: "after March" and "before June" are two rules on purpose.
     */
    const found = lens.rules.findIndex((r) => r.propertyId === property.id && isSetOp(r.op));
    setSlot(found >= 0 ? found : null);
    setDraft(found >= 0 ? lens.rules[found] : emptyRule(property));
    setPickedId(property.id);
    setQuery("");
    setAt(0);
    setRefused(null);
  }

  /* What my lens would hold with this rule answered, or with the answer taken
     back. The write and the leave both ask it, so they cannot disagree. */
  function lensAfter(next: FilterRule): FilterRule[] {
    if (!hasAnswer(next)) {
      return slot === null ? lens.rules : lens.rules.filter((_, i) => i !== slot);
    }
    if (slot === null) return [...lens.rules, next];
    return lens.rules.map((r, i) => (i === slot ? next : r));
  }

  /* The one place a rule arrives, changes or goes. It lands in my lens. */
  function change(next: FilterRule) {
    setDraft(next);
    if (hasAnswer(next)) {
      if (slot === null) setSlot(lens.rules.length);
      void setLens(lensAfter(next));
      return;
    }
    // The answer was taken back, so the rule goes with it.
    if (slot !== null) {
      void setLens(lensAfter(next));
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
              owed={(next) => (view ? lensSend(view.id, lensAfter(next)) : null)}
              onBack={reset}
              onClose={close}
            />
          ) : (
            <>
              <span className="label">Show only tasks where</span>
              {/* The same box in the same place as step two, so picking a
                  property reads as the box moving on rather than swapping. */}
              <AskBox
                query={query}
                onQuery={(value) => {
                  setQuery(value);
                  // Looking for another property is the answer to the line.
                  setRefused(null);
                }}
                rows={rows}
                at={at}
                setAt={setAt}
                onPick={(row) => pick(row.id)}
                listId="filter-properties"
                label="Find a property to filter by"
                placeholder="Which property?"
                testId="filter-search"
              />
              {/* The list stays where it is, so the next property is one
                  press away and nothing on the board has moved. */}
              {refused && (
                <span className={styles.filterNote} role="status" data-testid="filter-refused">
                  {refused}
                </span>
              )}
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
/* Asking a board for an order                                         */
/* ------------------------------------------------------------------ */

/** What the row of the order that is on says about which way it runs. */
const WAY: Record<SortDirection, string> = {
  asc: "Smallest first",
  desc: "Largest first",
};

/**
 * A list is ordered by pressing a heading. A board has no heading, so it asks
 * here instead — the same panel the filter opens, in the same place, because
 * there is nothing else in this product that a board has to learn twice.
 *
 * The rows are the columns a list would draw, named the way a list names them:
 * one question, one set of words, whichever shape the view is in. Pressing a
 * row is the press on a heading — down, then up, then back to the order the
 * board itself keeps — so `nextSort` stays the only place that rule lives.
 */
export function SortButton({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { cardItems, sort, setSort } = useBoard();
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);

  function close() {
    setOpen(false);
    setQuery("");
    setAt(0);
  }

  const ref = useDismiss<HTMLDivElement>(close, open);

  /* What a list would put a heading on. A board that offered more would order
     itself by something no card on it is drawing. */
  const rows: Row[] = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return listColumns(cardItems)
      .filter((column) => canSort(column.item))
      .filter((column) => !wanted || column.name.toLowerCase().includes(wanted))
      .map((column) => {
        const on = sort?.columnId === column.id;
        return {
          id: column.id,
          name: column.name,
          color: column.item.property ? propertyColor(column.item.property) : BUILTIN_DOT,
          on,
          note: on && sort ? WAY[sort.direction] : undefined,
        };
      });
  }, [cardItems, query, sort]);

  /* The panel stays open, because the second press is the one that turns the
     order around and it belongs on the row that says which order is on. */
  function pick(columnId: string) {
    void setSort(nextSort(sort, columnId));
    setQuery("");
    setAt(0);
  }

  return (
    <div className={styles.filterAnchor} ref={ref}>
      <button
        className={`${styles.pill} ${sort ? styles.filterOn : ""}`}
        data-testid="sort-button"
        aria-expanded={open}
        title={sort ? "Change the order the cards are in" : "Order the cards in every column"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className={styles.sortMark} aria-hidden />
        Sort
      </button>

      {open && (
        <div className={`${styles.popover} ${styles.filterPop}`} data-testid="sort-menu">
          <span className="label">Order the cards by</span>
          {/* The same box in the same place as the filter's, so the two
              controls beside each other are one thing to learn. */}
          <AskBox
            query={query}
            onQuery={setQuery}
            rows={rows}
            at={at}
            setAt={setAt}
            onPick={(row) => pick(row.id)}
            listId="sort-columns"
            label="Find what to order the cards by"
            placeholder="Which one?"
            testId="sort-search"
          />
          <Rows
            rows={rows}
            at={at}
            listId="sort-columns"
            empty="Nothing on the card can be ordered."
            onPick={(row) => pick(row.id)}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The chips under the strip                                           */
/* ------------------------------------------------------------------ */

/**
 * A filtered board says so on its own line, and the line is the control.
 *
 * Two sets of chips sit on it: the view's, which everybody on the board sees,
 * and mine, which nobody else does. They read the same and sit in the same
 * order the board reads them in — the view's first, then mine — because they
 * do the same thing to the cards. Only a thin divider and the tail say which
 * is which, and a second chip style would make them look like two features.
 *
 * The line exists while any rule hides a card, and also while the panel is
 * open, so the first answer does not push the board down a line under an open
 * panel.
 */
export function FilterChips({ panelOpen }: { panelOpen: boolean }) {
  const {
    data,
    view,
    filters,
    viewFilters,
    lens,
    sort,
    setSort,
    cardItems,
    setFilters,
    setLens,
    promoteLens,
  } = useBoard();
  const askable = filterProperties(data.properties);
  /* One order, drawn two ways, so one chip says it either way: a board is in
     the order as much as a list is, and the ✕ is the way out of both. */
  if (filters.rules.length === 0 && !sort && !panelOpen) return null;

  /** One rule of a set, changed or taken out. Both sets go the same way. */
  function edited(rules: FilterRule[], at: number, next: FilterRule | null): FilterRule[] {
    if (!next || !hasAnswer(next)) return rules.filter((_, i) => i !== at);
    return rules.map((r, i) => (i === at ? next : r));
  }

  return (
    <div className={styles.filterRow} data-testid="filter-row">
      {sort && <SortChip sort={sort} items={cardItems} onClear={() => void setSort(null)} />}

      {viewFilters.rules.map((rule, i) => {
        const property = askable.find((p) => p.id === rule.propertyId);
        if (!property) return null;
        return (
          <Chip
            key={`view-${rule.propertyId}-${i}`}
            rule={rule}
            property={property}
            members={data.members}
            shared
            onChange={(next) => void setFilters(edited(viewFilters.rules, i, next))}
            owed={(next) => (view ? viewSend(view.id, edited(viewFilters.rules, i, next)) : null)}
            onRemove={() => void setFilters(edited(viewFilters.rules, i, null))}
          />
        );
      })}

      {/* Only where the two meet. One set on its own needs nothing said. */}
      {viewFilters.rules.length > 0 && lens.rules.length > 0 && (
        <span className={styles.filterDivider} data-testid="filter-divider" aria-hidden />
      )}

      {lens.rules.map((rule, i) => {
        const property = askable.find((p) => p.id === rule.propertyId);
        if (!property) return null;
        return (
          <Chip
            key={`mine-${rule.propertyId}-${i}`}
            rule={rule}
            property={property}
            members={data.members}
            onChange={(next) => void setLens(edited(lens.rules, i, next))}
            owed={(next) => (view ? lensSend(view.id, edited(lens.rules, i, next)) : null)}
            onRemove={() => void setLens(edited(lens.rules, i, null))}
          />
        );
      })}

      {lens.rules.length > 0 && (
        <>
          {/* Mine only. The view's rules are the team's and go one at a time,
              through the question their own ✕ asks. */}
          <button
            className={styles.filterClear}
            data-testid="filter-clear"
            title="Remove the filters you added"
            onClick={() => void setLens([])}
          >
            Clear
          </button>
          <span className={styles.filterMine} data-testid="filter-mine">
            {/* The same sentence twice, because a phone has no room for the
                long one and the row must not wrap or clip. */}
            <span className={styles.wide}>· Only you see this —</span>
            <span className={styles.narrow}>Only you ·</span>
            <button
              className={styles.filterPromote}
              data-testid="filter-promote"
              title="Everybody on this board will see these filters"
              onClick={() => void promoteLens()}
            >
              <span className={styles.wide}>Save for everyone</span>
              <span className={styles.narrow}>Save for all</span>
            </button>
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The order a view is in, and the way out of it.
 *
 * A list heading says which column and which way, and a board has no heading
 * at all. Both leave the same thing unsaid: that the cards are no longer in
 * the order they can be dragged in. That is why this names the drag rather
 * than just the column, and why it is the one chip both shapes draw.
 */
function SortChip({
  sort,
  items,
  onClear,
}: {
  sort: ViewSort;
  items: CardItem[];
  onClear: () => void;
}) {
  const name = sortLabel(sort, items);
  if (!name) return null;

  return (
    <span className={`${styles.filterChip} ${styles.sortChip}`} data-testid="sort-chip">
      <span className={styles.filterChipBody}>
        {sort.direction === "asc" ? "\u2191" : "\u2193"} {name}
      </span>
      <button
        className={styles.filterChipX}
        data-testid="sort-clear"
        aria-label="Back to the board's own order"
        title="Back to the board's own order, which is the one you can drag"
        onClick={onClear}
      >
        ✕
      </button>
    </span>
  );
}

/**
 * One rule, and the two ways it can go.
 *
 * `shared` says the rule is the view's, so taking it away takes it away from
 * everybody who is looking at this board. The board has no dialogs, so the
 * chip becomes the question where it stands, exactly as a settings row does,
 * and it names who pays: "Remove for everyone?". Escape or a click elsewhere
 * puts the chip back.
 */
function Chip({
  rule,
  property,
  members,
  shared = false,
  onChange,
  owed,
  onRemove,
}: {
  rule: FilterRule;
  property: PropertyDTO;
  members: MemberDTO[];
  shared?: boolean;
  onChange: (rule: FilterRule) => void;
  owed: (rule: FilterRule) => LeaveSend | null;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const asking = useConfirm();
  const said = describeRule(rule, property, members);
  const ref = useDismiss<HTMLDivElement>(() => {
    setOpen(false);
    asking.cancel();
  }, open || asking.asking);

  /*
   * The question takes the focus, so putting the chip back has to give it
   * back. Escape unmounts the Remove button, and focus would fall to the body:
   * the next Tab then starts at the top of the page, a long way from the row
   * the person was working on. The ✕ is where they were, so that is where
   * they go back to.
   */
  const cross = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current && !asking.asking) cross.current?.focus();
    asked.current = asking.asking;
  }, [asking.asking]);

  if (asking.asking) {
    return (
      <div className={styles.filterAnchor} ref={ref}>
        <span
          className={`${styles.filterChip} ${styles.filterChipAsking}`}
          role="alertdialog"
          aria-label={`Remove the filter ${said} for everyone?`}
          data-testid="filter-chip-question"
        >
          <span className={styles.filterChipBody}>Remove for everyone?</span>
          <button
            className={styles.filterChipGo}
            autoFocus
            data-testid="filter-chip-remove"
            onClick={() => asking.confirm(onRemove)}
          >
            Remove
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className={styles.filterAnchor} ref={ref}>
      <span className={`${styles.filterChip} ${open ? styles.filterChipOpen : ""}`}>
        <button
          className={styles.filterChipBody}
          data-testid="filter-chip"
          data-shared={shared ? "true" : undefined}
          aria-expanded={open}
          title="Change this filter"
          onClick={() => setOpen((v) => !v)}
        >
          {said}
        </button>
        <button
          className={styles.filterChipX}
          ref={cross}
          aria-label={
            shared ? `Remove the filter ${said} for everyone` : `Remove the filter ${said}`
          }
          title={shared ? "Remove for everyone" : "Remove"}
          onClick={() => (shared ? asking.ask() : onRemove())}
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
            owed={owed}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
