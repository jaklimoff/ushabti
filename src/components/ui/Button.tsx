"use client";

import Link from "next/link";
import styles from "./ui.module.css";

type Variant = "primary" | "ghost" | "danger" | "text";

/**
 * A button. `busy` is for the wait after a press: the button keeps its colour
 * and its focus and draws a turning ring, where a disabled one went grey and
 * read as refused. A press while busy does nothing, a submit included.
 */
export function Button({
  variant = "primary",
  size = "md",
  block = false,
  busy = false,
  className,
  children,
  onClick,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "md" | "lg";
  block?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      aria-busy={busy || undefined}
      aria-disabled={busy || rest["aria-disabled"] || undefined}
      onClick={busy ? (event) => event.preventDefault() : onClick}
      className={[
        styles.btn,
        styles[variant],
        size === "lg" ? styles.btnLg : "",
        block ? styles.btnBlock : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {busy && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

/**
 * A link that looks like a button, for a press that goes to an address — a
 * file to save — rather than one that runs code on this page.
 */
export function ButtonLink({
  variant = "primary",
  className,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return (
    <a
      {...rest}
      className={[styles.btn, styles[variant], className ?? ""].filter(Boolean).join(" ")}
    />
  );
}

/**
 * A link to another page of this app that looks like a button. It goes
 * through the router, which a file to save must not.
 */
export function ButtonPageLink({
  variant = "primary",
  className,
  ...rest
}: React.ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      {...rest}
      className={[styles.btn, styles[variant], className ?? ""].filter(Boolean).join(" ")}
    />
  );
}

/**
 * One of a few choices, pressed in place, with the press said by
 * `aria-pressed`. A quiet pill is still pressable; it reads as already used.
 * `color` puts the option's dot before the words, the same 6 px dot a card
 * draws beside an option, so an option looks one way wherever it is picked.
 */
export function Pill({
  on,
  quiet = false,
  color,
  className,
  children,
  ...rest
}: Omit<React.ComponentProps<"button">, "aria-pressed"> & {
  on: boolean;
  quiet?: boolean;
  color?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      aria-pressed={on}
      className={[styles.pill, quiet ? styles.pillQuiet : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {color && <Dot color={color} />}
      {children}
    </button>
  );
}

/**
 * The swatch beside a word: one 6 px round dot, everywhere. A square is the
 * card view's `colour` mode only, where the colour is the whole chip.
 */
export function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={[styles.dot, className ?? ""].filter(Boolean).join(" ")}
      style={{ background: color }}
    />
  );
}

/**
 * A square glyph button. The label is required: the view pill used to carry a
 * bare ✕ that announced as nothing at all. It comes in two sizes: 24 inside a
 * row, 28 beside a control of `--control-h`. No third.
 */
export function IconButton({
  label,
  danger = false,
  size = 24,
  className,
  children,
  ...rest
}: Omit<React.ComponentProps<"button">, "aria-label"> & {
  label: string;
  danger?: boolean;
  size?: 24 | 28;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={rest.title ?? label}
      {...rest}
      className={[
        styles.iconBtn,
        size === 28 ? styles.iconBtnLg : "",
        danger ? styles.iconBtnDanger : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}
