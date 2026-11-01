"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useBoard } from "@/components/board/store";
import { OptionIcon } from "@/components/board/OptionIcon";
import { Input } from "@/components/ui/Form";
import { useDismiss } from "@/components/ui/useDismiss";
import { PALETTE, colorName } from "@/lib/colors";
import {
  findIcons,
  iconLabel,
  readOptionIcon,
  type OptionIcon as IconName,
} from "@/lib/option-icons";
import type { PropertyDTO, PropertyOptionDTO } from "@/lib/types";
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

  /* The option's colour as a variable, so a hover, the picked swatch and the
     picked icon can all wear it from the stylesheet. */
  const look = { "--look": option.color } as CSSProperties;

  return (
    <span ref={ref} className={styles.lookHold}>
      {/* The colour is the longhand, because on a phone the button holds a
          24 px square and clips the colour to the middle of it. The
          `background` shorthand would put that clip back to the whole button. */}
      <button
        ref={button}
        type="button"
        className={`${styles.swatchBtn} ${icon ? styles.swatchBtnIcon : ""}`}
        style={icon ? look : { ...look, backgroundColor: option.color }}
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
          style={look}
          role="dialog"
          aria-label={`Colour and icon of ${option.name}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeToButton();
          }}
        >
          <span className={styles.popHead} aria-hidden="true">
            Colour
          </span>
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
          <span className={styles.popHead}>
            <span aria-hidden="true">Icon</span>
            <button
              type="button"
              className={`${styles.iconNone} ${icon ? "" : styles.iconNoneOn}`}
              aria-pressed={!icon}
              onClick={() => pickIcon(null)}
            >
              No icon
            </button>
          </span>
          <IconGrid name={option.name} current={icon} onPick={(next) => pickIcon(next)} />
        </span>
      )}
    </span>
  );
}

/**
 * A checkbox's icon, behind one button: what a ticked box draws on a card in
 * Icon mode. The grid is the option's own, with no palette, because a
 * checkbox has no colour. The button wears what the card would draw, so with
 * no icon picked it wears the CheckSquare Icon mode falls back to.
 */
export function FlagLook({ property, mayEdit }: { property: PropertyDTO; mayEdit: boolean }) {
  const { patchProperty } = useBoard();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLSpanElement>(close, open);
  const icon = readOptionIcon(property.config.icon);
  const look = { "--look": "var(--text-meta)" } as CSSProperties;

  function closeToButton() {
    setOpen(false);
    button.current?.focus();
  }

  function pickIcon(next: IconName | null) {
    closeToButton();
    if (next !== icon) void patchProperty(property.id, { icon: next });
  }

  return (
    <span ref={ref} className={styles.flagHold}>
      <button
        ref={button}
        type="button"
        className={`${styles.swatchBtn} ${styles.swatchBtnIcon}`}
        style={look}
        aria-label={`Icon of ${property.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={mayEdit ? "The icon a ticked box shows on a card" : undefined}
        disabled={!mayEdit}
        data-icon={icon ?? ""}
        onClick={() => setOpen((v) => !v)}
      >
        <OptionIcon name={icon ?? "CheckSquare"} color="var(--text-meta)" size={12} />
      </button>
      {open && (
        <span
          className={styles.swatchPop}
          style={look}
          role="dialog"
          aria-label={`Icon of ${property.name}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeToButton();
          }}
        >
          <span className={styles.popHead}>
            <span aria-hidden="true">Icon</span>
            <button
              type="button"
              className={`${styles.iconNone} ${icon ? "" : styles.iconNoneOn}`}
              aria-pressed={!icon}
              onClick={() => pickIcon(null)}
            >
              No icon
            </button>
          </span>
          <IconGrid name={property.name} current={icon} onPick={(next) => pickIcon(next)} />
        </span>
      )}
    </span>
  );
}

/**
 * The icons, with a box above that narrows them. One tab stop in the grid:
 * the arrows walk the cells, Home and End go to the ends, and the cell the
 * walk is on is the one Tab comes back to. In the box, Enter picks the first
 * icon found and the down arrow steps into the grid.
 */
function IconGrid({
  name,
  current,
  onPick,
}: {
  name: string;
  current: IconName | null;
  onPick: (icon: IconName) => void;
}) {
  const [query, setQuery] = useState("");
  const icons = findIcons(query);
  const [at, setAt] = useState(() => Math.max(current ? icons.indexOf(current) : 0, 0));
  const box = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const last = icons.length - 1;

  /* With a mouse the box takes the focus, so typing finds at once. A phone
     is left alone: a keyboard rising over the sheet hides the icons. */
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) box.current?.focus();
  }, []);

  /* The grid scrolls, so it opens on the picked icon rather than on the
     first row. Its own scroll only: the page must not move. */
  useEffect(() => {
    const cell = current ? cells.current[at] : null;
    const scroller = grid.current;
    if (!cell || !scroller) return;
    scroller.scrollTop = cell.offsetTop - scroller.offsetTop - scroller.clientHeight / 2;
    // Only on open: a search moves the walk, not the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function search(next: string) {
    setQuery(next);
    const found = findIcons(next);
    setAt(Math.max(current ? found.indexOf(current) : 0, 0));
  }

  function onBoxKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && icons.length > 0) {
      e.preventDefault();
      onPick(icons[0]);
    } else if (e.key === "ArrowDown" && icons.length > 0) {
      e.preventDefault();
      cells.current[at]?.focus();
    }
  }

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
    <>
      <Input
        ref={box}
        type="search"
        size="sm"
        block
        className={styles.iconSearch}
        value={query}
        placeholder="Search icons"
        aria-label={`Search icons for ${name}`}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => search(e.target.value)}
        onKeyDown={onBoxKeyDown}
      />
      {icons.length === 0 ? (
        <span className={styles.iconNothing}>No icon matches “{query.trim()}”.</span>
      ) : (
        <div
          ref={grid}
          className={styles.iconGrid}
          role="listbox"
          aria-label={`Icon of ${name}`}
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
        >
          {icons.map((icon, i) => {
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
                {/* No colour of its own: the cell's, so the grid reads grey and
                    only the icon under the pointer and the picked one wear the
                    option's colour. */}
                <OptionIcon name={icon} size={14} />
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
