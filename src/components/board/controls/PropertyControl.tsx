"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { tint } from "@/lib/colors";
import { formatDate } from "@/lib/board";
import type { MemberDTO, PropertyDTO, PropertyOptionDTO, TaskValue } from "@/lib/types";
import { optionMenu } from "@/lib/option-menu";
import { Avatar } from "@/components/ui/Avatar";
import { useDismiss } from "@/components/ui/useDismiss";
import { walkKeys } from "../Ask";
import styles from "./controls.module.css";

type Props = {
  property: PropertyDTO;
  value: TaskValue;
  members: MemberDTO[];
  onChange: (value: TaskValue) => void;
  onAddOption?: (name: string) => Promise<string | null>;
  /** The label beside the field, which names it. A selection draws the
      property's name as a button of its own, so it has none to point at. */
  labelId?: string;
};

/**
 * The name a screen reader gives a control: the label, then what the control
 * itself says. Without it the panel read "Empty, button" once for each empty
 * field, and nobody could tell which one.
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

/** A row of options fits as a segmented control only when it stays narrow. */
function fitsSegmented(property: PropertyDTO): boolean {
  if (property.options.length === 0 || property.options.length > 5) return false;
  const width = property.options.reduce((sum, o) => sum + o.name.length, 0);
  return width <= 26 && property.options.every((o) => o.name.length <= 8);
}

export function PropertyControl(props: Props) {
  switch (props.property.type) {
    case "select":
      return fitsSegmented(props.property) ? (
        <SelectSegmented {...props} />
      ) : (
        <SelectMenu {...props} />
      );
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

/** A menu taller than its box scrolls, and the highlight must stay in sight. */
function useHighlightInView(at: number, open: boolean) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = menu.current?.querySelector<HTMLElement>('[data-at="true"]');
    row?.scrollIntoView?.({ block: "nearest" });
  }, [at, open]);
  return menu;
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
            id={`${listId}-${i}`}
            entry={entry}
            at={i === at}
            on={isOn(entry)}
            onPick={() => pick(entry)}
          />
        ))}
      </div>
    </>
  );
}

/** A row of the menu. Empty and Add wear a dot like an option, so they line up. */
function EntryRow({
  id,
  entry,
  at,
  on,
  onPick,
}: {
  id: string;
  entry: Entry;
  at: boolean;
  on: boolean;
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
          : "Empty"}
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

function SelectMenu({ property, value, onChange, onAddOption, labelId }: Props) {
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

  const { matches, add } = optionMenu(property.options, draft);
  // A search shows what matches, so Empty steps aside while somebody types.
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
      const here = property.options.findIndex((o) => o.id === value);
      setAt(draft.trim() ? 0 : here + 1);
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
          {current?.name ?? "Empty"}
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

const LIST_STEPS: Record<string, (at: number, count: number) => number> = {
  ArrowDown: (at, count) => Math.min(at + 1, count - 1),
  ArrowUp: (at) => Math.max(at - 1, 0),
  Home: () => 0,
  End: (_at, count) => count - 1,
};

/**
 * A short list of people, so it has no box to type in: the focus goes into
 * the list, onto the person already chosen, and the arrows walk it. Every row
 * is still a button, so Enter and Space pick as they always did.
 */
function PersonMenu({ value, members, onChange, labelId }: Props) {
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const ref = useDismiss<HTMLDivElement>(() => {
    focusBack(trigger.current);
    setOpen(false);
  }, open);
  const current = members.find((m) => m.id === value);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  function pick(id: string | null) {
    onChange(id);
    focusBack(trigger.current);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = LIST_STEPS[event.key];
    if (!step || !list.current) return;
    event.preventDefault();
    const rows = [...list.current.querySelectorAll<HTMLElement>('[role="option"]')];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    rows[step(Math.max(at, 0), rows.length)]?.focus();
  }

  const rows: { id: string | null; name: string; face: React.ReactNode }[] = [
    { id: null, name: "Unassigned", face: NOBODY },
    ...members.map((member) => ({
      id: member.id,
      name: member.name,
      face: <Avatar name={member.name} color={member.color} size={18} />,
    })),
  ];

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        ref={trigger}
        id={triggerId}
        className={`${styles.trigger} ${styles.triggerAvatar} ${open ? styles.triggerOpen : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...named(labelId, triggerId)}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? <Avatar name={current.name} color={current.color} size={18} /> : NOBODY}
        <span className={`${styles.triggerText} ${current ? "" : styles.triggerEmpty}`}>
          {current?.name ?? "Unassigned"}
        </span>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className={styles.menu}
          style={{ top: 32 }}
          ref={list}
          role="listbox"
          {...(labelId ? { "aria-labelledby": labelId } : { "aria-label": "People" })}
          onKeyDown={onKeyDown}
        >
          {rows.map((row) => {
            const on = (value ?? null) === row.id;
            return (
              <button
                key={row.id ?? "nobody"}
                className={`${styles.menuItem} ${on && row.id ? styles.menuItemOn : ""}`}
                role="option"
                aria-selected={on}
                onClick={() => pick(row.id)}
              >
                {row.face}
                {row.name}
                <span style={{ flex: 1 }} />
                <span
                  className={styles.tick}
                  aria-hidden="true"
                  style={{ color: on ? "var(--accent)" : "transparent" }}
                >
                  ✓
                </span>
              </button>
            );
          })}
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

function DateField({ value, onChange, labelId }: Props) {
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
        {text || "Empty"}
      </span>
    </button>
  );
}

function ScalarField({ value, onChange, numeric, labelId }: Props & { numeric?: boolean }) {
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
      placeholder="Empty"
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
