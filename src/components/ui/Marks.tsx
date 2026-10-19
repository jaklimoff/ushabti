import { PROJECT_INK } from "@/lib/colors";
import type { ViewKind } from "@/lib/types";
import styles from "./ui.module.css";

/** The U of `src/app/icon.svg`, so the bar and the browser tab draw one mark. */
const BRAND_U = "M11.6 8.7v7.6a4.4 4.4 0 0 0 8.8 0V8.7";

/**
 * Ushabti's own mark: the teal U. It means the app and always leads Home, so
 * it never stands for a project. A project wears `ProjectMark`.
 */
export function BrandMark({ size = 18 }: { size?: 16 | 18 | 22 | 32 }) {
  // The icon is drawn on 32 units. Its 2.6 stroke would be 1.3 px at 16, too
  // thin to read as a U, so the stroke never falls under 1.4 px.
  const unit = size / 32;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={styles.brandMark}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      data-brand-mark=""
    >
      <rect width="32" height="32" rx={Math.ceil(size / 4) / unit} fill="var(--accent)" />
      <path
        d={BRAND_U}
        fill="none"
        stroke="var(--accent-ink)"
        strokeWidth={Math.max(2.6, 1.4 / unit)}
      />
    </svg>
  );
}

/**
 * A project's square: its own colour and its whole key, in the dark ink
 * Home draws it with. The same project reads the same on Home, on the board,
 * in settings and in the switcher. The teal is Ushabti's, never a project's.
 */
export function ProjectMark({
  projectKey,
  color,
  size = 18,
  className,
  ...rest
}: Omit<React.ComponentProps<"span">, "color"> & {
  projectKey: string;
  color: string;
  size?: 16 | 18 | 22;
}) {
  return (
    <span
      aria-hidden
      {...rest}
      className={[styles.projectMark, className ?? ""].filter(Boolean).join(" ")}
      style={{
        height: size,
        minWidth: size,
        borderRadius: Math.ceil(size / 4),
        background: color,
        color: PROJECT_INK,
        ...rest.style,
      }}
    >
      {projectKey}
    </span>
  );
}

/**
 * The caret of a menu. The ▾ glyph falls back to a dot at 9 px in IBM Plex,
 * so it is drawn. It takes the colour of the text it sits in.
 */
export function Chevron({ size = 10, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 4l2.5 2.5L7.5 4" />
    </svg>
  );
}

/**
 * What a kind of view looks like: a dot for a board, three lines for a list,
 * three staggered bars for a roadmap. Drawn here rather than taken from an
 * icon set, like the comment bubble on a card. The strip above the board and
 * Settings → Views both draw this one, so a kind reads the same in both.
 */
export function ViewKindMark({
  kind,
  on = true,
  color = "currentColor",
}: {
  kind: ViewKind;
  on?: boolean;
  color?: string;
}) {
  const opacity = on ? 1 : 0.45;
  if (kind === "board") {
    return <span aria-hidden className={styles.kindDot} style={{ background: color, opacity }} />;
  }
  return (
    <svg
      viewBox="0 0 8 8"
      width="8"
      height="8"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "0 0 8px", opacity }}
    >
      <path
        d={kind === "roadmap" ? "M0.5 1.5h3.5M2.5 4h4M4 6.5h3.5" : "M0.5 1.5h7M0.5 4h7M0.5 6.5h7"}
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
