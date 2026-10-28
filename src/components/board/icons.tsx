/*
 * The board's own small shapes. Typed glyphs ("+", "↓", "✓", "«") came out at
 * four weights on four baselines, and "↓" said nothing about archiving. These
 * share one grid, one stroke and the colour of the text around them, like the
 * chain and the comment bubble on a card.
 */

function Icon({ size = 12, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function PlusIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M6 2.25v7.5M2.25 6h7.5" />
    </Icon>
  );
}

/** A tray with a lid: the cards go in and stay kept. */
export function ArchiveIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="1.5" y="2" width="9" height="2.6" rx="0.6" />
      <path d="M2.4 4.6v4.3a1 1 0 0 0 1 1h5.2a1 1 0 0 0 1-1V4.6M4.8 6.7h2.4" />
    </Icon>
  );
}

export function CheckIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M2.5 6.3l2.4 2.4 4.6-5" />
    </Icon>
  );
}

/** A chevron pointing at a bar: the column folds to the strip on its left. */
export function FoldIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M2.25 2.5v7M8.75 3L5.75 6l3 3" />
    </Icon>
  );
}

/* The three tools of the view strip. On a phone their words go, so each
   mark has to say what it is on its own. */

/** A card with its stripe down the left and one line of title. */
export function CardIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="1.5" y="2.25" width="9" height="7.5" rx="1.4" />
      <path d="M3.9 2.5v7M5.9 5h2.6M5.9 7h1.6" />
    </Icon>
  );
}

/** Up and down: an order, which takes nothing away. */
export function SortIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 9.75v-7.5M2.25 4 4 2.25 5.75 4M8 2.25v7.5M6.25 8 8 9.75 9.75 8" />
    </Icon>
  );
}

/** A funnel: some cards go through, the rest stay out. */
export function FilterIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M1.75 2.5h8.5L7 6.25v2.9L5 10.1V6.25z" />
    </Icon>
  );
}
