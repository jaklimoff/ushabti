"use client";

import type { CardChip } from "@/lib/card-view";
import { ink } from "@/lib/colors";
import { Avatar } from "@/components/ui/Avatar";
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

  return (
    <span className={className} style={paint} title={chip.tip} data-testid="card-chip">
      {chip.swatch && (
        <span
          className={chip.swatch.round ? styles.cardChipDot : styles.cardChipSquare}
          style={{ background: chip.swatch.color }}
        />
      )}
      {chip.person && <Avatar name={chip.person.name} color={chip.person.color} size={17} />}
      {chip.bubble && <CommentIcon />}
      {chip.bar && (
        <span className={styles.cardProgressBar}>
          <span
            className={styles.cardProgressFill}
            style={{ width: `${(chip.bar.done / chip.bar.total) * 100}%` }}
          />
        </span>
      )}
      {chip.text !== null && (
        <span className={chip.mono ? styles.cardChipText : styles.cardChipWords}>{chip.text}</span>
      )}
    </span>
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
