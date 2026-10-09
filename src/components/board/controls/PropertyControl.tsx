"use client";

import { useId, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { tint } from "@/lib/colors";
import { formatDate } from "@/lib/board";
import { currentOption, keyName } from "@/lib/filters";
import { NO_VALUE_KEY } from "@/lib/types";
import type { FormerDTO, MemberDTO, PropertyDTO, PropertyOptionDTO, TaskValue } from "@/lib/types";
import { personMenu, personName, personOf, personOpeningAt } from "@/lib/people";
import { openingAt, optionMenu } from "@/lib/option-menu";
import { pickableOptions } from "@/lib/option-dates";
import { LinkError, linkLabel, linksOf, readLinks } from "@/lib/web-links";
import { Avatar } from "@/components/ui/Avatar";
import { useDismiss } from "@/components/ui/useDismiss";
import { useHighlightInView, walkKeys } from "../Ask";
import { useBoard } from "../store";
import styles from "./controls.module.css";

type Props = {
  property: PropertyDTO;
  value: TaskValue;
  members: MemberDTO[];
  /** Who a value may still name after they left. Shown, never offered. */
  former?: FormerDTO[];
  onChange: (value: TaskValue) => void;
  onAddOption?: (name: string) => Promise<string | null>;
  /** The board's day, which an iteration's picker reads "current" against. */
  today: string;
  /** The label beside the field, which names it. A selection draws the
      property's name as a button of its own, so it has none to point at. */
  labelId?: string;
  /** Every option the property has, where `property` lists fewer. */
  taken?: PropertyOptionDTO[];
};

/**
 * The name a screen reader gives a control: the label, then what the control
 * itself says. Without it the panel read "No priority, button" once for each
 * empty field, and nobody could tell which one.
 */
function named(labelId: string | undefined, selfId?: string) {
  if (!labelId) return {};
  return { "aria-labelledby": selfId ? `${labelId} ${selfId}` : labelId };
}

/**
 * Where the focus goes when a menu shuts on a key: back to the button that
 * opened it. Only when the focus was inside the menu, so a click somewhere
 * else keeps the focus it gave.
 */
function focusBack(trigger: HTMLElement | null) {
  const field = trigger?.closest(`.${styles.wrap}`);
  if (field && field.contains(document.activeElement)) trigger?.focus();
}

/**
 * What an empty field says: "No priority", "Unassigned". A column and a filter
 * chip already say it that way, so the panel does not teach a second word.
 */
function noneName(property: PropertyDTO): string {
  return keyName(NO_VALUE_KEY, property, []);
}

/**
 * A row of options fits as a segmented control only when it stays narrow. An
 * iteration never does: a row of buttons has no place to open on, and the
 * current sprint is what its picker opens on.
 */
function fitsSegmented(property: PropertyDTO): boolean {
  if (property.type === "iteration") return false;
  if (property.options.length === 0 || property.options.length > 5) return false;
  const width = property.options.reduce((sum, o) => sum + o.name.length, 0);
  return width <= 26 && property.options.every((o) => o.name.length <= 8);
}

export function PropertyControl(props: Props) {
  switch (props.property.type) {
    case "iteration":
    case "select": {
      // A shipped sprint leaves the picker, but a task that still holds one
      // keeps it, so the field never reads empty.
      const picked = {
        ...props,
        property: { ...props.property, options: pickableOptions(props.property, props.value) },
        taken: props.property.options,
      };
      return fitsSegmented(picked.property) ? (
        <SelectSegmented {...picked} />
      ) : (
        <SelectMenu {...picked} />
      );
    }
    case "multi_select":
      return <MultiSelect {...props} />;
    case "person":
      return <PersonMenu {...props} />;
    case "checkbox":
      return <CheckboxToggle {...props} />;
    case "date":
      return <DateField {...props} />;
    case "number":
      return <ScalarField {...props} numeric />;
    case "link":
      return <LinkList {...props} />;
    default:
      return <ScalarField {...props} />;
  }
}

function SelectSegmented({ property, value, onChange, labelId }: Props) {
  const mono = property.options.every((o) => o.name.length <= 3);
  return (
    <div className={styles.wrap}>
      <div className={styles.seg} role="group" {...named(labelId)}>
        {property.options.map((option) => {
          const on = value === option.id;
          return (
            <button
              key={option.id}
              className={`${styles.segItem} ${mono ? styles.segMono : ""} ${on ? styles.segItemOn : ""}`}
              style={on ? { background: tint(option.color, 0.18) } : undefined}
              aria-pressed={on}
              onClick={() => onChange(on ? null : option.id)}
              title={on ? "Click to clear" : option.name}
            >
              {!mono && (
                <span
                  className={styles.dot}
                  style={{ background: option.color, opacity: on ? 1 : 0.45 }}
                />
              )}
              {option.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One row of a select's menu. The menu walks them in the order drawn. */
type Entry =
  { kind: "empty" } | { kind: "option"; option: PropertyOptionDTO } | { kind: "add"; name: string };

function entryKey(entry: Entry): string {
  if (entry.kind === "option") return entry.option.id;
  return entry.kind;
}

/**
 * Making an option is a write everybody sees, and the server takes a name
 * twice. So while one is on its way, a second Enter or press does nothing:
 * one Enter makes one option.
 */
function useOneAtATime() {
  const busy = useRef(false);
  return async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await work();
    } finally {
      busy.current = false;
    }
  };
}

/**
 * The box and the rows under it, in the shape `AskBox` has: the box keeps the
 * focus and the highlight is `aria-activedescendant`, so a row is an option
 * and not a button, and a press on one does not take the focus away.
 */
function OptionMenu({
  property,
  entries,
  at,
  setAt,
  draft,
  setDraft,
  canAdd,
  isOn,
  pick,
  current = null,
}: {
  property: PropertyDTO;
  entries: Entry[];
  at: number;
  setAt: Dispatch<SetStateAction<number>>;
  draft: string;
  setDraft: (value: string) => void;
  canAdd: boolean;
  isOn: (entry: Entry) => boolean;
  pick: (entry: Entry) => void;
  /** The option that holds today, which its row names. */
  current?: string | null;
}) {
  const listId = useId();
  const name = property.name.toLowerCase();
  return (
    <>
      <input
        className={styles.menuInput}
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={entries.length ? `${listId}-${at}` : undefined}
        aria-label={canAdd ? `Find or add ${name}` : `Find ${name}`}
        value={draft}
        placeholder={canAdd ? "Find or add…" : "Find…"}
        onChange={(e) => {
          setDraft(e.target.value);
          setAt(0);
        }}
        onKeyDown={walkKeys(entries.length, at, setAt, (i) => pick(entries[i]))}
      />
      <div className={styles.menuList} role="listbox" id={listId} aria-label={property.name}>
        {entries.map((entry, i) => (
          <EntryRow
            key={entryKey(entry)}
            none={noneName(property)}
            id={`${listId}-${i}`}
            entry={entry}
            at={i === at}
            on={isOn(entry)}
            current={entry.kind === "option" && entry.option.id === current}
            onPick={() => pick(entry)}
          />
        ))}
      </div>
    </>
  );
}

/** A row of the menu. None and Add wear a dot like an option, so they line up. */
function EntryRow({
  id,
  none,
  entry,
  at,
  on,
  current,
  onPick,
}: {
  id: string;
  none: string;
  entry: Entry;
  at: boolean;
  on: boolean;
  current: boolean;
  onPick: () => void;
}) {
  const color =
    entry.kind === "option"
      ? entry.option.color
      : entry.kind === "add"
        ? "var(--accent)"
        : "#3f4650";
  return (
    <div
      id={id}
      role="option"
      aria-selected={on}
      className={`${styles.menuItem} ${on && entry.kind === "option" ? styles.menuItemOn : ""} ${
        at ? styles.menuItemAt : ""
      }`}
      data-at={at}
      // The box must keep the focus, so the press must not move it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      <span className={styles.dot} style={{ background: color }} />
      {entry.kind === "option"
        ? entry.option.name
        : entry.kind === "add"
          ? `Add “${entry.name}”`
          : none}
      {current && <span className={styles.current}>current</span>}
      {entry.kind !== "add" && (
        <>
          <span style={{ flex: 1 }} />
          <span
            className={styles.tick}
            aria-hidden
            style={{ color: on ? "var(--accent)" : "transparent" }}
          >
            ✓
          </span>
        </>
      )}
    </div>
  );
}

function SelectMenu({ property, value, onChange, onAddOption, labelId, taken, today }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [rawAt, setAt] = useState(0);
  const triggerId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const ref = useDismiss<HTMLDivElement>(() => {
    focusBack(trigger.current);
    setOpen(false);
  }, open);
  const once = useOneAtATime();
  const current = property.options.find((o) => o.id === value);
  // A dated select is not asked: "current" there is the filter's word only.
  const now = property.type === "iteration" ? currentOption(property, today) : null;

  const { matches, add } = optionMenu(property.options, draft, taken);
  // A search shows what matches, so the empty row steps aside while somebody types.
  const entries: Entry[] = [
    ...(draft.trim() ? [] : [{ kind: "empty" } as const]),
    ...matches.map((option) => ({ kind: "option", option }) as const),
    ...(add && onAddOption ? [{ kind: "add", name: add } as const] : []),
  ];
  // Another tab may take an option away under the highlight.
  const at = Math.min(rawAt, Math.max(entries.length - 1, 0));
  const menu = useHighlightInView(at, open);

  function close() {
    focusBack(trigger.current);
    setOpen(false);
    setDraft("");
  }

  function pick(entry: Entry) {
    if (entry.kind === "add") {
      return void once(async () => {
        const id = await onAddOption?.(entry.name);
        close();
        if (id) onChange(id);
      });
    }
    onChange(entry.kind === "option" ? entry.option.id : null);
    close();
  }

  function toggleOpen() {
    if (!open) {
      const here = openingAt(property.options, typeof value === "string" ? value : null, now);
      setAt(draft.trim() ? 0 : here);
    }
    setOpen((v) => !v);
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        ref={trigger}
        id={triggerId}
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...named(labelId, triggerId)}
        onClick={toggleOpen}
      >
        <span className={styles.dot} style={{ background: current?.color ?? "#3f4650" }} />
        <span className={`${styles.triggerText} ${current ? "" : styles.triggerEmpty}`}>
          {current?.name ?? noneName(property)}
        </span>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className={styles.menu} ref={menu}>
          <OptionMenu
            property={property}
            entries={entries}
            at={at}
            setAt={setAt}
            draft={draft}
            setDraft={setDraft}
            canAdd={!!onAddOption}
            isOn={(entry) =>
              entry.kind === "option" ? value === entry.option.id : entry.kind === "empty" && !value
            }
            pick={pick}
            current={now}
          />
        </div>
      )}
    </div>
  );
}

function MultiSelect({ property, value, onChange, onAddOption, labelId }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [rawAt, setAt] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const ref = useDismiss<HTMLDivElement>(() => {
    focusBack(trigger.current);
    setOpen(false);
  }, open);
  const once = useOneAtATime();
  const selected = Array.isArray(value) ? value : [];
  const chosen = selected
    .map((id) => property.options.find((o) => o.id === id))
    .filter((o): o is PropertyDTO["options"][number] => !!o);

  const { matches, add } = optionMenu(property.options, draft);
  const entries: Entry[] = [
    ...matches.map((option) => ({ kind: "option", option }) as const),
    ...(add && onAddOption ? [{ kind: "add", name: add } as const] : []),
  ];
  const at = Math.min(rawAt, Math.max(entries.length - 1, 0));
  const menu = useHighlightInView(at, open);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  // The menu stays open to take a second option, so the highlight stays on
  // the one just toggled rather than jumping to the top of the list.
  function pick(entry: Entry) {
    if (entry.kind === "add") {
      return void once(async () => {
        const id = await onAddOption?.(entry.name);
        setDraft("");
        setAt(0);
        if (id) onChange([...selected, id]);
      });
    }
    if (entry.kind !== "option") return;
    toggle(entry.option.id);
    setDraft("");
    setAt(Math.max(property.options.indexOf(entry.option), 0));
  }

  return (
    <div className={styles.wrap} ref={ref} style={{ display: "block" }}>
      <div className={styles.chips} role="group" {...named(labelId)}>
        {chosen.map((option) => (
          <span
            key={option.id}
            className={styles.chip}
            style={{ background: tint(option.color, 0.13) }}
          >
            <span className={styles.dot} style={{ background: option.color }} />
            {option.name}
            <button
              className={styles.chipRemove}
              title="Remove"
              aria-label={`Remove ${option.name}`}
              onClick={() => toggle(option.id)}
            >
              ✕
            </button>
          </span>
        ))}
        <button
          ref={trigger}
          className={styles.chipAdd}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            if (!open) setAt(0);
            setOpen((v) => !v);
          }}
        >
          + {property.name.toLowerCase()}
        </button>
      </div>
      {open && (
        <div className={styles.menu} style={{ top: 28 }} ref={menu}>
          <OptionMenu
            property={property}
            entries={entries}
            at={at}
            setAt={setAt}
            draft={draft}
            setDraft={setDraft}
            canAdd={!!onAddOption}
            isOn={(entry) => entry.kind === "option" && selected.includes(entry.option.id)}
            pick={pick}
          />
        </div>
      )}
    </div>
  );
}

const NOBODY = (
  <span
    style={{
      width: 18,
      height: 18,
      borderRadius: "50%",
      border: "1px dashed #2f343c",
      display: "inline-block",
    }}
  />
);

/**
 * The picker's box and rows, in the shape `OptionMenu` has: the box keeps the
 * focus and the highlight is `aria-activedescendant`. A member list grows past
 * the eight rows the menu shows, so finding somebody takes a few keys, and the
 * reader sits first because they are who is picked most.
 */
function PersonMenu({ value, members, former = [], onChange, labelId }: Props) {
  const me = useBoard().user.id;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [rawAt, setAt] = useState(0);
  const triggerId = useId();
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const ref = useDismiss<HTMLDivElement>(() => {
    focusBack(trigger.current);
    setOpen(false);
    setDraft("");
  }, open);
  /* Somebody who left is read as the value and drawn as gone. The rows below
     offer only members, so picking anyone hands the task on. */
  const current = personOf(value, members, former);

  const people = personMenu(members, me, draft);
  // A search shows who matches, so the empty row steps aside while somebody types.
  const rows: { id: string | null; name: string; face: React.ReactNode }[] = [
    ...(draft.trim() ? [] : [{ id: null, name: "Unassigned", face: NOBODY }]),
    ...people.map((member) => ({
      id: member.id,
      name: member.name,
      face: (
        <Avatar
          name={member.name}
          color={member.color}
          emoji={member.emoji}
          kind={member.kind}
          size={18}
        />
      ),
    })),
  ];
  // Somebody may leave the project under the highlight.
  const at = Math.min(rawAt, Math.max(rows.length - 1, 0));
  const menu = useHighlightInView(at, open);

  function pick(id: string | null) {
    onChange(id);
    focusBack(trigger.current);
    setOpen(false);
    setDraft("");
  }

  function toggleOpen() {
    if (!open) setAt(personOpeningAt(people, typeof value === "string" ? value : null, me));
    setOpen((v) => !v);
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        ref={trigger}
        id={triggerId}
        className={`${styles.trigger} ${styles.triggerAvatar} ${open ? styles.triggerOpen : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...named(labelId, triggerId)}
        onClick={toggleOpen}
      >
        {/* The face draws initials as text, and the name is already there. */}
        <span aria-hidden="true" style={{ display: "contents" }}>
          {current ? (
            <Avatar
              name={current.name}
              color={current.color}
              emoji={current.emoji}
              kind={current.kind}
              gone={current.gone}
              size={18}
            />
          ) : (
            NOBODY
          )}
        </span>
        <span
          className={`${styles.triggerText} ${current && !current.gone ? "" : styles.triggerEmpty}`}
        >
          {current ? personName(current) : "Unassigned"}
        </span>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className={styles.menu} style={{ top: 32 }} ref={menu}>
          <input
            className={styles.menuInput}
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={rows.length ? `${listId}-${at}` : undefined}
            aria-label="Find a person"
            value={draft}
            placeholder="Find…"
            onChange={(e) => {
              setDraft(e.target.value);
              setAt(0);
            }}
            onKeyDown={walkKeys(rows.length, at, setAt, (i) => pick(rows[i].id))}
          />
          <div
            className={styles.menuList}
            role="listbox"
            id={listId}
            {...(labelId ? { "aria-labelledby": labelId } : { "aria-label": "People" })}
          >
            {rows.map((row, i) => {
              const on = (value ?? null) === row.id;
              return (
                <div
                  key={row.id ?? "nobody"}
                  id={`${listId}-${i}`}
                  className={`${styles.menuItem} ${on && row.id ? styles.menuItemOn : ""} ${
                    i === at ? styles.menuItemAt : ""
                  }`}
                  role="option"
                  aria-selected={on}
                  data-at={i === at}
                  // The box must keep the focus, so the press must not move it.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(row.id)}
                >
                  <span aria-hidden="true" style={{ display: "contents" }}>
                    {row.face}
                  </span>
                  {row.name}
                  <span style={{ flex: 1 }} />
                  <span
                    className={styles.tick}
                    aria-hidden="true"
                    style={{ color: on ? "var(--accent)" : "transparent" }}
                  >
                    ✓
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckboxToggle({ value, onChange, labelId }: Props) {
  const on = value === true;
  return (
    <button
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      role="switch"
      aria-checked={on}
      {...named(labelId)}
      onClick={() => onChange(!on)}
    >
      <span className={`${styles.knob} ${on ? styles.knobOn : ""}`} />
    </button>
  );
}

function DateField({ property, value, onChange, labelId }: Props) {
  const [editing, setEditing] = useState(false);
  const buttonId = useId();
  const text = typeof value === "string" && value ? formatDate(value) : "";

  if (editing) {
    return (
      <input
        className={styles.textInput}
        type="date"
        autoFocus
        {...named(labelId)}
        defaultValue={typeof value === "string" ? value : ""}
        onBlur={(e) => {
          setEditing(false);
          onChange(e.target.value || null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      className={styles.trigger}
      id={buttonId}
      {...named(labelId, buttonId)}
      onClick={() => setEditing(true)}
    >
      <span className={`${styles.triggerText} ${text ? "" : styles.triggerEmpty}`}>
        {text || noneName(property)}
      </span>
    </button>
  );
}

function ScalarField({
  property,
  value,
  onChange,
  numeric,
  labelId,
}: Props & { numeric?: boolean }) {
  const [draft, setDraft] = useState<string>(
    value === null || value === undefined ? "" : String(value),
  );
  const [dirty, setDirty] = useState(false);

  const shown = dirty ? draft : value === null || value === undefined ? "" : String(value);

  function commit() {
    setDirty(false);
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange(null);
      return;
    }
    onChange(numeric ? Number(trimmed) : trimmed);
  }

  return (
    <input
      className={styles.textInput}
      inputMode={numeric ? "decimal" : undefined}
      {...named(labelId)}
      value={shown}
      placeholder={noneName(property)}
      onChange={(e) => {
        setDirty(true);
        setDraft(e.target.value);
      }}
      onBlur={() => dirty && commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDirty(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/**
 * The links of a task, each a real link that opens in a new tab, and a box to
 * paste one more into. The box adds on Enter or on blur, as every value box of
 * the panel saves. A link the server would refuse stays in the box with the
 * reason beside it, rather than vanish as if it were saved.
 */
function LinkList({ property, value, onChange, labelId }: Props) {
  const links = linksOf(value);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function add() {
    const text = draft.trim();
    if (!text) {
      setProblem(null);
      return;
    }
    let next: string[];
    try {
      next = readLinks([...links, text]);
    } catch (error) {
      if (!(error instanceof LinkError)) throw error;
      setProblem(`${property.name} ${error.message}`);
      return;
    }
    setDraft("");
    setProblem(null);
    if (next.length !== links.length) onChange(next);
  }

  return (
    <div className={styles.wrap} style={{ display: "block" }}>
      <div className={styles.links} role="group" {...named(labelId)}>
        {links.map((link) => (
          <span key={link} className={styles.link}>
            <a
              className={styles.linkText}
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              title={link}
            >
              {linkLabel(link)}
            </a>
            <button
              className={styles.chipRemove}
              title="Remove"
              aria-label={`Remove ${linkLabel(link)}`}
              onClick={() => onChange(links.filter((l) => l !== link))}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          className={styles.textInput}
          type="url"
          aria-label={`Add a link to ${property.name}`}
          aria-invalid={problem ? true : undefined}
          value={draft}
          placeholder="Paste a link…"
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
            /* No blur here: the blur would add the words Escape just took back. */
            if (e.key === "Escape") {
              setDraft("");
              setProblem(null);
            }
          }}
        />
        {problem && (
          <span className={styles.linkProblem} role="alert">
            {problem}
          </span>
        )}
      </div>
    </div>
  );
}
