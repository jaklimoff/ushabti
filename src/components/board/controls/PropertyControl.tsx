"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import { tint } from "@/lib/colors";
import { formatDate } from "@/lib/board";
import type { MemberDTO, PropertyDTO, PropertyOptionDTO, TaskValue } from "@/lib/types";
import { optionMenu } from "@/lib/option-menu";
import { Avatar } from "@/components/ui/Avatar";
import { useDismiss } from "@/components/ui/useDismiss";
import { step } from "../Ask";
import styles from "./controls.module.css";

type Props = {
  property: PropertyDTO;
  value: TaskValue;
  members: MemberDTO[];
  onChange: (value: TaskValue) => void;
  onAddOption?: (name: string) => Promise<string | null>;
};

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

function SelectSegmented({ property, value, onChange }: Props) {
  const mono = property.options.every((o) => o.name.length <= 3);
  return (
    <div className={styles.wrap}>
      <div className={styles.seg}>
        {property.options.map((option) => {
          const on = value === option.id;
          return (
            <button
              key={option.id}
              className={`${styles.segItem} ${mono ? styles.segMono : ""} ${on ? styles.segItemOn : ""}`}
              style={on ? { background: tint(option.color, 0.18) } : undefined}
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
 * The keys of the box above a menu. It is the walk `AskBox` makes: the box
 * keeps the focus, the arrows move a highlight, Enter picks the highlighted
 * row and nothing else. Typing puts the highlight back on the first row.
 */
function walkKeys(
  entries: Entry[],
  at: number,
  setAt: Dispatch<SetStateAction<number>>,
  pick: (entry: Entry) => void,
) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      return setAt((n) => step(n, entries.length, 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      return setAt((n) => step(n, entries.length, -1));
    }
    if (e.key === "Enter" && entries[at]) {
      e.preventDefault();
      pick(entries[at]);
    }
  };
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

function SelectMenu({ property, value, onChange, onAddOption }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [rawAt, setAt] = useState(0);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
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
    setOpen(false);
    setDraft("");
  }

  async function createOption(name: string) {
    if (!onAddOption) return;
    const id = await onAddOption(name);
    close();
    if (id) onChange(id);
  }

  function pick(entry: Entry) {
    if (entry.kind === "add") return void createOption(entry.name);
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
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        onClick={toggleOpen}
      >
        <span className={styles.dot} style={{ background: current?.color ?? "#3f4650" }} />
        <span className={`${styles.triggerText} ${current ? "" : styles.triggerEmpty}`}>
          {current?.name ?? "Empty"}
        </span>
        <span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div className={styles.menu} ref={menu}>
          {onAddOption && (
            <input
              className={styles.menuInput}
              autoFocus
              value={draft}
              placeholder="Find or add…"
              aria-label={`Find or add ${property.name.toLowerCase()}`}
              onChange={(e) => {
                setDraft(e.target.value);
                setAt(0);
              }}
              onKeyDown={walkKeys(entries, at, setAt, pick)}
            />
          )}
          {entries.map((entry, i) => (
            <EntryRow
              key={entryKey(entry)}
              entry={entry}
              at={i === at}
              on={
                entry.kind === "option"
                  ? value === entry.option.id
                  : entry.kind === "empty" && !value
              }
              onPick={() => pick(entry)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A row of the menu. Empty and Add wear a dot like an option, so they line up. */
function EntryRow({
  entry,
  at,
  on,
  onPick,
}: {
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
    <button
      className={`${styles.menuItem} ${on && entry.kind === "option" ? styles.menuItemOn : ""} ${
        at ? styles.menuItemAt : ""
      }`}
      data-at={at}
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
          <span className={styles.tick} style={{ color: on ? "var(--accent)" : "transparent" }}>
            ✓
          </span>
        </>
      )}
    </button>
  );
}

function MultiSelect({ property, value, onChange, onAddOption }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [rawAt, setAt] = useState(0);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
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

  async function createOption(name: string) {
    if (!onAddOption) return;
    const id = await onAddOption(name);
    setDraft("");
    setAt(0);
    if (id) onChange([...selected, id]);
  }

  // The menu stays open to take a second option, so the highlight stays on
  // the one just toggled rather than jumping to the top of the list.
  function pick(entry: Entry) {
    if (entry.kind === "add") return void createOption(entry.name);
    if (entry.kind !== "option") return;
    toggle(entry.option.id);
    setDraft("");
    setAt(Math.max(property.options.indexOf(entry.option), 0));
  }

  return (
    <div className={styles.wrap} ref={ref} style={{ display: "block" }}>
      <div className={styles.chips}>
        {chosen.map((option) => (
          <span
            key={option.id}
            className={styles.chip}
            style={{ background: tint(option.color, 0.13) }}
          >
            <span className={styles.dot} style={{ background: option.color }} />
            {option.name}
            <button className={styles.chipRemove} title="Remove" onClick={() => toggle(option.id)}>
              ✕
            </button>
          </span>
        ))}
        <button
          className={styles.chipAdd}
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
          {onAddOption && (
            <input
              className={styles.menuInput}
              autoFocus
              value={draft}
              placeholder="Find or add…"
              aria-label={`Find or add ${property.name.toLowerCase()}`}
              onChange={(e) => {
                setDraft(e.target.value);
                setAt(0);
              }}
              onKeyDown={walkKeys(entries, at, setAt, pick)}
            />
          )}
          {entries.map((entry, i) => (
            <EntryRow
              key={entryKey(entry)}
              entry={entry}
              at={i === at}
              on={entry.kind === "option" && selected.includes(entry.option.id)}
              onPick={() => pick(entry)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PersonMenu({ value, members, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  const current = members.find((m) => m.id === value);

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={`${styles.trigger} ${styles.triggerAvatar} ${open ? styles.triggerOpen : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? (
          <Avatar name={current.name} color={current.color} size={18} />
        ) : (
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: "1px dashed #2f343c",
              display: "inline-block",
            }}
          />
        )}
        <span className={`${styles.triggerText} ${current ? "" : styles.triggerEmpty}`}>
          {current?.name ?? "Unassigned"}
        </span>
        <span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div className={styles.menu} style={{ top: 32 }}>
          <button
            className={styles.menuItem}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: "1px dashed #2f343c",
                display: "inline-block",
              }}
            />
            Unassigned
            <span style={{ flex: 1 }} />
            <span
              className={styles.tick}
              style={{ color: value ? "transparent" : "var(--accent)" }}
            >
              ✓
            </span>
          </button>
          {members.map((member) => (
            <button
              key={member.id}
              className={`${styles.menuItem} ${value === member.id ? styles.menuItemOn : ""}`}
              onClick={() => {
                onChange(member.id);
                setOpen(false);
              }}
            >
              <Avatar name={member.name} color={member.color} size={18} />
              {member.name}
              <span style={{ flex: 1 }} />
              <span
                className={styles.tick}
                style={{ color: value === member.id ? "var(--accent)" : "transparent" }}
              >
                ✓
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckboxToggle({ value, onChange }: Props) {
  const on = value === true;
  return (
    <button
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className={`${styles.knob} ${on ? styles.knobOn : ""}`} />
    </button>
  );
}

function DateField({ value, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const text = typeof value === "string" && value ? formatDate(value) : "";

  if (editing) {
    return (
      <input
        className={styles.textInput}
        type="date"
        autoFocus
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
    <button className={styles.trigger} onClick={() => setEditing(true)}>
      <span className={`${styles.triggerText} ${text ? "" : styles.triggerEmpty}`}>
        {text || "Empty"}
      </span>
    </button>
  );
}

function ScalarField({ value, onChange, numeric }: Props & { numeric?: boolean }) {
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
