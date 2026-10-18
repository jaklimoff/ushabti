import { PROJECT_INK } from "@/lib/colors";
import styles from "./ui.module.css";

/**
 * Ushabti's own mark: the teal U. It means the app and always leads Home, so
 * it never stands for a project. A project wears `ProjectMark`.
 */
export function BrandMark({ size = 18 }: { size?: 16 | 18 | 22 | 32 }) {
  return (
    <span
      aria-hidden
      className={styles.brandMark}
      style={{
        width: size,
        height: size,
        flexBasis: size,
        borderRadius: Math.ceil(size / 4),
        fontSize: Math.round(size * 0.55),
      }}
    >
      U
    </span>
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
