"use client";

import { type KeyboardEvent, useCallback, useRef, useState } from "react";
import { useBoard } from "@/components/board/store";
import { OptionIcon } from "@/components/board/OptionIcon";
import { useDismiss } from "@/components/ui/useDismiss";
import { PALETTE, colorName } from "@/lib/colors";
import {
  iconLabel,
  OPTION_ICONS,
  readOptionIcon,
  type OptionIcon as IconName,
} from "@/lib/option-icons";
import type { PropertyOptionDTO } from "@/lib/types";
import styles from "./settings.module.css";

/** As many as Mnemes puts in a row, so the two pickers read the same. */
const PER_ROW = 8;

/**
 * An option's colour and icon, behind one button. The button wears the icon
 * in the colour when there is one, and the colour alone when there is not.
 * A pick saves at once and closes; there is nothing to confirm.
 */
export function OptionLook({ option, mayEdit }: { option: PropertyOptionDTO; mayEdit: boolean }) {
  const { patchOption } = useBoard();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLSpanElement>(close, open);
  const icon = readOptionIcon(option.icon);

  /* Escape is the dismiss hook's too; this half only hands the focus back. */
  function closeToButton() {
    setOpen(false);
    button.current?.focus();
  }

  function pickIcon(next: IconName | null) {
    closeToButton();
    if (next !== icon) void patchOption(option.id, { icon: next });
  }

  return (
    <span ref={ref} className={styles.lookHold}>
      {/* The colour is the longhand, because on a phone the button holds a
          24 px square and clips the colour to the middle of it. The
          `background` shorthand would put that clip back to the whole button. */}
      <button
        ref={button}
        type="button"
        className={`${styles.swatchBtn} ${icon ? styles.swatchBtnIcon : ""}`}
        style={icon ? undefined : { backgroundColor: option.color }}
        aria-label={`Colour of ${option.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={mayEdit ? "Colour and icon" : undefined}
        disabled={!mayEdit}
        onClick={() => setOpen((v) => !v)}
      >
        {icon && <OptionIcon name={icon} color={option.color} size={12} />}
      </button>
      {open && (
        <span
          className={styles.swatchPop}
          role="dialog"
          aria-label={`Colour and icon of ${option.name}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeToButton();
          }}
        >
          <span className={styles.swatchRow} role="listbox" aria-label={`Colour of ${option.name}`}>
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                role="option"
                aria-selected={color === option.color}
                aria-label={colorName(color)}
                title={colorName(color)}
                className={`${styles.swatchChip} ${color === option.color ? styles.swatchChipOn : ""}`}
                style={{ background: color }}
                onClick={() => {
                  closeToButton();
                  if (color !== option.color) void patchOption(option.id, { color });
                }}
              />
            ))}
          </span>
          <IconGrid
            name={option.name}
            color={option.color}
            current={icon}
            onPick={(next) => pickIcon(next)}
          />
          <button
            type="button"
            className={`${styles.iconNone} ${icon ? "" : styles.iconNoneOn}`}
            aria-pressed={!icon}
            onClick={() => pickIcon(null)}
          >
            No icon
          </button>
        </span>
      )}
    </span>
  );
}

/**
 * Every icon in the catalogue, in its order. One tab stop: the arrows walk
 * the cells, Home and End go to the ends, and the cell the walk is on is the
 * one Tab comes back to.
 */
function IconGrid({
  name,
  color,
  current,
  onPick,
}: {
  name: string;
  color: string;
  current: IconName | null;
  onPick: (icon: IconName) => void;
}) {
  const [at, setAt] = useState(() => Math.max(current ? OPTION_ICONS.indexOf(current) : 0, 0));
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const last = OPTION_ICONS.length - 1;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: PER_ROW,
      ArrowUp: -PER_ROW,
    };
    let next: number | null = null;
    if (e.key in step) {
      const to = at + step[e.key];
      next = to < 0 || to > last ? at : to;
    } else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    setAt(next);
    cells.current[next]?.focus();
  }

  return (
    <div
      className={styles.iconGrid}
      role="listbox"
      aria-label={`Icon of ${name}`}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
    >
      {OPTION_ICONS.map((icon, i) => {
        const label = iconLabel(icon);
        const on = icon === current;
        return (
          <button
            key={icon}
            ref={(node) => {
              cells.current[i] = node;
            }}
            type="button"
            role="option"
            aria-selected={on}
            aria-label={label}
            title={label}
            tabIndex={i === at ? 0 : -1}
            className={`${styles.iconCell} ${on ? styles.iconCellOn : ""}`}
            onFocus={() => setAt(i)}
            onClick={() => onPick(icon)}
          >
            <OptionIcon name={icon} color={color} size={14} />
          </button>
        );
      })}
    </div>
  );
}
