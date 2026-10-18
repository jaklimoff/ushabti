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
