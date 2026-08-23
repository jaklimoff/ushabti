"use client";

import { AVATAR_COLORS, initials } from "@/lib/colors";
import styles from "./ui.module.css";

export function Input({
  size = "md",
  block = false,
  invalid = false,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: "md" | "lg";
  block?: boolean;
  invalid?: boolean;
}) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={[
        styles.input,
        size === "lg" ? styles.inputLg : "",
        block ? styles.inputBlock : "",
        invalid ? styles.inputInvalid : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export function Select({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={[styles.input, className ?? ""].filter(Boolean).join(" ")} />;
}

/** A name that edits in place. Invisible until you touch it. */
export function NameInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...rest} className={[styles.nameInput, className ?? ""].filter(Boolean).join(" ")} />
  );
}

/**
 * A label, its control, and the sentence under it. The label to control
 * relationship used to be an inline `style={{ width: 60 }}` in three places.
 */
export function Field({
  label,
  note,
  error,
  inline = false,
  children,
}: {
  label: string;
  note?: React.ReactNode;
  error?: string | null;
  inline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={inline ? styles.fieldRow : styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : note ? (
        <span className={styles.fieldNote}>{note}</span>
      ) : null}
    </div>
  );
}

/**
 * The colour of a person, picked from the palette rather than from the
 * operating system's wheel. Each swatch wears the initials it will carry, so
 * the choice shows what it will actually look like on a card.
 */
export function ColorSwatches({
  name,
  value,
  onPick,
}: {
  name: string;
  value: string;
  onPick: (color: string) => void;
}) {
  const mark = initials(name);
  return (
    <div className={styles.swatches} role="radiogroup" aria-label="Your colour">
      {AVATAR_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          aria-label={`Colour ${color}`}
          title={color}
          className={`${styles.swatch} ${color === value ? styles.swatchOn : ""}`}
          style={{ background: color }}
          onClick={() => onPick(color)}
        >
          {mark}
        </button>
      ))}
    </div>
  );
}
