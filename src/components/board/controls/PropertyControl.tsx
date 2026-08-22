"use client";

import { useState } from "react";
import { tint } from "@/lib/colors";
import { formatDate } from "@/lib/board";
import type { MemberDTO, PropertyDTO, TaskValue } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { useDismiss } from "@/components/ui/useDismiss";
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

function SelectMenu({ property, value, onChange, onAddOption }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  const current = property.options.find((o) => o.id === value);

  const filtered = draft
    ? property.options.filter((o) => o.name.toLowerCase().includes(draft.toLowerCase()))
    : property.options;

  async function createOption() {
    const name = draft.trim();
    if (!name || !onAddOption) return;
    const id = await onAddOption(name);
    setDraft("");
    setOpen(false);
    if (id) onChange(id);
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.dot} style={{ background: current?.color ?? "#3f4650" }} />
        <span className={`${styles.triggerText} ${current ? "" : styles.triggerEmpty}`}>
          {current?.name ?? "Empty"}
        </span>
        <span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div className={styles.menu}>
          {onAddOption && (
            <input
              className={styles.menuInput}
              autoFocus
              value={draft}
              placeholder="Find or add…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (filtered.length === 1) {
                    onChange(filtered[0].id);
                    setOpen(false);
                    setDraft("");
                  } else void createOption();
                }
              }}
            />
          )}
          <button
            className={styles.menuItem}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <span className={styles.dot} style={{ background: "#3f4650" }} />
            Empty
            <span style={{ flex: 1 }} />
            <span
              className={styles.tick}
              style={{ color: value ? "transparent" : "var(--accent)" }}
            >
              ✓
            </span>
          </button>
          {filtered.map((option) => (
            <button
              key={option.id}
              className={`${styles.menuItem} ${value === option.id ? styles.menuItemOn : ""}`}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
                setDraft("");
              }}
            >
              <span className={styles.dot} style={{ background: option.color }} />
              {option.name}
              <span style={{ flex: 1 }} />
              <span
                className={styles.tick}
                style={{ color: value === option.id ? "var(--accent)" : "transparent" }}
              >
                ✓
              </span>
            </button>
          ))}
          {draft.trim() && filtered.length === 0 && onAddOption && (
            <button className={styles.menuItem} onClick={() => void createOption()}>
              <span className={styles.dot} style={{ background: "var(--accent)" }} />
              Add “{draft.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MultiSelect({ property, value, onChange, onAddOption }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useDismiss<HTMLDivElement>(() => setOpen(false), open);
  const selected = Array.isArray(value) ? value : [];
  const chosen = selected
    .map((id) => property.options.find((o) => o.id === id))
    .filter((o): o is PropertyDTO["options"][number] => !!o);

  const filtered = draft
    ? property.options.filter((o) => o.name.toLowerCase().includes(draft.toLowerCase()))
    : property.options;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  async function createOption() {
    const name = draft.trim();
    if (!name || !onAddOption) return;
    const id = await onAddOption(name);
    setDraft("");
    if (id) onChange([...selected, id]);
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
        <button className={styles.chipAdd} onClick={() => setOpen((v) => !v)}>
          + {property.name.toLowerCase()}
        </button>
      </div>
      {open && (
        <div className={styles.menu} style={{ top: 28 }}>
          {onAddOption && (
            <input
              className={styles.menuInput}
              autoFocus
              value={draft}
              placeholder="Find or add…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (filtered.length === 1) {
                    toggle(filtered[0].id);
                    setDraft("");
                  } else void createOption();
                }
              }}
            />
          )}
          {filtered.map((option) => (
            <button
              key={option.id}
              className={`${styles.menuItem} ${selected.includes(option.id) ? styles.menuItemOn : ""}`}
              onClick={() => toggle(option.id)}
            >
              <span className={styles.dot} style={{ background: option.color }} />
              {option.name}
              <span style={{ flex: 1 }} />
              <span
                className={styles.tick}
                style={{ color: selected.includes(option.id) ? "var(--accent)" : "transparent" }}
              >
                ✓
              </span>
            </button>
          ))}
          {draft.trim() && filtered.length === 0 && onAddOption && (
            <button className={styles.menuItem} onClick={() => void createOption()}>
              <span className={styles.dot} style={{ background: "var(--accent)" }} />
              Add “{draft.trim()}”
            </button>
          )}
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
