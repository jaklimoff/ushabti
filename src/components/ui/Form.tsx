"use client";

import { useState } from "react";
import { AVATAR_COLORS, facePaint, initials } from "@/lib/colors";
import { FACE_EMOJI, isOneEmoji } from "@/lib/emoji";
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
 * A checkbox drawn in the page's colours. It is a real checkbox under the
 * paint, so the keyboard and a screen reader meet it as before, and the label
 * round it makes the words a part of the control.
 */
export function Checkbox({
  label,
  className,
  ...rest
}: Omit<React.ComponentPropsWithRef<"input">, "type"> & { label: React.ReactNode }) {
  return (
    <label className={[styles.check, className ?? ""].filter(Boolean).join(" ")}>
      <input {...rest} type="checkbox" className={styles.checkBox} />
      {label}
    </label>
  );
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
  kind = "human",
  label = "Your colour",
  value,
  onPick,
}: {
  name: string;
  /** A person who wears an emoji sees it on each colour, as the board will draw it. */
  emoji?: string | null;
  /** An agent with no emoji wears ◆ where a person wears initials. */
  kind?: "human" | "agent";
  label?: string;
  value: string;
  onPick: (color: string) => void;
}) {
  const mark = emoji ?? plainMark(name, kind);
  return (
    <div className={styles.swatches} role="radiogroup" aria-label={label}>
      {AVATAR_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          aria-label={`Colour ${color}`}
          title={color}
          className={`${styles.swatch} ${emoji ? styles.swatchFace : ""} ${color === value ? styles.swatchOn : ""}`}
          style={swatchPaint(color, Boolean(emoji))}
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
 * shows as picked rather than leaving nothing picked. The box after the grid
 * is how a person reaches that emoji without the API.
 */
export function FaceSwatches({
  name,
  color,
  kind = "human",
  label = "Your face",
  value,
  onPick,
}: {
  name: string;
  color: string;
  /** An agent's plain face is ◆, not initials. */
  kind?: "human" | "agent";
  label?: string;
  value: string | null;
  onPick: (emoji: string | null) => void;
}) {
  const faces = value && !FACE_EMOJI.includes(value) ? [...FACE_EMOJI, value] : FACE_EMOJI;
  const plain = kind === "agent" ? "No emoji" : "Initials";
  const [typed, setTyped] = useState("");
  const wrong = typed.trim() !== "";
  return (
    <div className={styles.faces}>
      <div className={styles.swatches} role="radiogroup" aria-label={label}>
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label={plain}
          title={plain}
          className={`${styles.swatch} ${value === null ? styles.swatchOn : ""}`}
          style={swatchPaint(color, false)}
          onClick={() => onPick(null)}
        >
          {plainMark(name, kind)}
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
            style={swatchPaint(color, true)}
            onClick={() => onPick(face)}
          >
            {face}
          </button>
        ))}
      </div>
      {/* It saves on input and then empties, so it never holds words that a
          closed tab could lose, and it needs no useSaveOnLeave. */}
      <Input
        className={styles.faceBox}
        invalid={wrong}
        placeholder="Or type any emoji"
        aria-label="Or type any emoji"
        value={typed}
        onChange={(event) => {
          const text = event.target.value;
          if (!isOneEmoji(text.trim())) return setTyped(text);
          setTyped("");
          onPick(text.trim());
        }}
      />
      {wrong && (
        <span className={styles.fieldError} role="alert">
          One emoji only.
        </span>
      )}
    </div>
  );
}

/**
 * The avatar's paint on a swatch. The colour goes in as `backgroundColor`
 * because the `background` shorthand would undo the swatch's clip, and the
 * ring would sit inside the border instead of on the edge.
 */
function swatchPaint(color: string, wearsEmoji: boolean) {
  const { background, ...rest } = facePaint(color, wearsEmoji);
  return { ...rest, backgroundColor: background };
}

function plainMark(name: string, kind: "human" | "agent") {
  return kind === "agent" ? "◆" : initials(name);
}
