"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardChip } from "@/lib/card-view";
import { ink } from "@/lib/colors";
import { Avatar } from "@/components/ui/Avatar";
import { Meter } from "@/components/ui/Layout";
import { OptionIcon } from "./OptionIcon";
import styles from "./board.module.css";

/**
 * One small part of a task: a colour, a face, a word, a bar or a count.
 *
 * A card draws these down its own places and a list row draws them across its
 * cells, and both have to read the same. It lives on its own so that stays
 * true by construction rather than by luck.
 */
export function Chip({ chip }: { chip: CardChip }) {
  const className = [
    styles.cardChip,
    chip.boxed ? styles.cardChipBoxed : "",
    chip.fill ? styles.cardChipFill : "",
  ]
    .filter(Boolean)
    .join(" ");

  /* A filled chip carries its colour behind the words, so the words take the
     ink that reads on it. */
  const paint = chip.fill ? { background: chip.fill, color: ink(chip.fill) } : undefined;

  /* A colour, an icon or a face alone names nothing to somebody who has not
     learned the board yet, so it says what it is the moment it is pointed at.
     The browser's own tooltip comes a second late and would sit on top of
     this one, so a wordless chip carries none. One with words keeps it: they
     may be cut short. */
  const wordless = chip.text === null;
  const [at, setAt] = useState<DOMRect | null>(null);
  const hide = useCallback(() => setAt(null), []);

  return (
    <span
      className={className}
      style={paint}
      title={wordless ? undefined : chip.tip}
      role={wordless ? "img" : undefined}
      aria-label={wordless ? chip.tip : undefined}
      data-tip={chip.tip}
      data-testid="card-chip"
      data-item={chip.item}
      onPointerEnter={
        wordless
          ? (e) => {
              /* A held button is a drag passing over, not somebody asking. */
              if (e.pointerType === "mouse" && e.buttons === 0)
                setAt(e.currentTarget.getBoundingClientRect());
            }
          : undefined
      }
      onPointerLeave={wordless ? hide : undefined}
      onPointerDown={wordless ? hide : undefined}
    >
      {at && <ChipTip text={chip.tip} at={at} onGone={hide} />}
      {chip.icon && (
        /* In a fill the icon takes the ink of the words; beside them it takes
           the option's colour, where the swatch would have been. A pixel over
           the default: lucide leaves a margin inside the box, and at 12 the
           drawing sat smaller than the words beside it. */
        <OptionIcon
          name={chip.icon}
          color={chip.swatch?.color}
          size={13}
          className={styles.cardChipIcon}
        />
      )}
      {chip.swatch && !chip.icon && (
        <span
          className={chip.swatch.round ? styles.cardChipDot : styles.cardChipSquare}
          style={{ background: chip.swatch.color }}
        />
      )}
      {chip.person && (
        <Avatar
          name={chip.person.name}
          color={chip.person.color}
          emoji={chip.person.emoji}
          kind={chip.person.kind}
          gone={chip.person.gone}
          size={18}
          title={wordless ? null : undefined}
        />
      )}
      {chip.bubble && <CommentIcon />}
      {chip.bar && (
        <Meter done={chip.bar.done} total={chip.bar.total} className={styles.cardProgressBar} />
      )}
      {chip.text !== null && (
        <span className={chip.mono ? styles.cardChipText : styles.cardChipWords}>{chip.text}</span>
      )}
    </span>
  );
}

/** Room the tip keeps from the chip and from the window's edge. */
const GAP = 6;
const EDGE = 8;

/**
 * The words of a wordless chip, over it. It is drawn on the body, because a
 * card and a column both clip what hangs past them. It is placed once, where
 * the chip was when the pointer came, so a scroll takes it away rather than
 * leaving it behind.
 */
function ChipTip({ text, at, onGone }: { text: string; at: DOMRect; onGone: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const tip = ref.current;
    if (!tip) return;
    const { width, height } = tip.getBoundingClientRect();
    const centre = at.left + at.width / 2;
    const left = Math.min(Math.max(centre - width / 2, EDGE), window.innerWidth - width - EDGE);
    /* Above the chip, unless the window ends there. */
    const top = at.top - GAP - height >= EDGE ? at.top - GAP - height : at.bottom + GAP;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.visibility = "visible";
  }, [at]);

  useLayoutEffect(() => {
    window.addEventListener("scroll", onGone, true);
    return () => window.removeEventListener("scroll", onGone, true);
  }, [onGone]);

  return createPortal(
    <span ref={ref} className={styles.chipTip} aria-hidden="true" data-testid="chip-tip">
      {text}
    </span>,
    document.body,
  );
}

/** A hairline speech bubble. The board draws its own shapes; no icon set. */
function CommentIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">
      <path
        d="M3 2h6a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5.2L3 11.3V9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
