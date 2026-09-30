"use client";

import { AVATAR_COLORS, ink, initials } from "@/lib/colors";
import { FACE_EMOJI } from "@/lib/emoji";
import styles from "./ui.module.css";

/**
 * It takes a `ref` because a password box is read from the page and not from
 * a copy: a password manager can write the box without an event React hears.
 */
export function Input({
  size = "md",
  block = false,
  invalid = false,
  className,
  ...rest
}: Omit<React.ComponentPropsWithRef<"input">, "size"> & {
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

/**
 * A name that edits in place. Invisible until you touch it.
 *
 * It takes a `ref` because a box that holds its own words has to be readable
 * when the page is left; see `useSaveOnLeave`.
 */
export function NameInput({ className, ...rest }: React.ComponentPropsWithRef<"input">) {
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
  emoji = null,
  value,
  onPick,
}: {
  name: string;
  /** A person who wears an emoji sees it on each colour, as the board will draw it. */
  emoji?: string | null;
  value: string;
  onPick: (color: string) => void;
}) {
  const mark = emoji ?? initials(name);
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
          className={`${styles.swatch} ${emoji ? styles.swatchFace : ""} ${color === value ? styles.swatchOn : ""}`}
          style={{ background: color, color: ink(color) }}
          onClick={() => onPick(color)}
        >
          {mark}
        </button>
      ))}
    </div>
  );
}

/**
 * Initials, or one emoji from a fixed grid, each on the person's own colour.
 * The route takes any one emoji, so a face set elsewhere joins the grid and
 * shows as picked rather than leaving nothing picked.
 */
export function FaceSwatches({
  name,
  color,
  value,
  onPick,
}: {
  name: string;
  color: string;
  value: string | null;
  onPick: (emoji: string | null) => void;
}) {
  const faces = value && !FACE_EMOJI.includes(value) ? [...FACE_EMOJI, value] : FACE_EMOJI;
  const swatch = { background: color, color: ink(color) };
  return (
    <div className={styles.swatches} role="radiogroup" aria-label="Your face">
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label="Initials"
        title="Initials"
        className={`${styles.swatch} ${value === null ? styles.swatchOn : ""}`}
        style={swatch}
        onClick={() => onPick(null)}
      >
        {initials(name)}
      </button>
      {faces.map((face) => (
        <button
          key={face}
          type="button"
          role="radio"
          aria-checked={face === value}
          aria-label={`Face ${face}`}
          title={face}
          className={`${styles.swatch} ${styles.swatchFace} ${face === value ? styles.swatchOn : ""}`}
          style={swatch}
          onClick={() => onPick(face)}
        >
          {face}
        </button>
      ))}
    </div>
  );
}
