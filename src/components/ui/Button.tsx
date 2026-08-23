"use client";

import styles from "./ui.module.css";

type Variant = "primary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "md" | "lg";
  block?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={[
        styles.btn,
        styles[variant],
        size === "lg" ? styles.btnLg : "",
        block ? styles.btnBlock : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

/**
 * A square glyph button. The label is required: the view pill used to carry a
 * bare ✕ that announced as nothing at all.
 */
export function IconButton({
  label,
  danger = false,
  className,
  children,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={rest.title ?? label}
      {...rest}
      className={[styles.iconBtn, danger ? styles.iconBtnDanger : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}
