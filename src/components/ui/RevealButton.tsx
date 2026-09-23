import styles from "./RevealButton.module.css";

/**
 * A password box with its eye beside it, so the row reads as one control.
 * Sign in, sign up, a reset link and the account page all use it, so one
 * reveal reads one way everywhere.
 */
export function PasswordRow({ children }: { children: React.ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

/**
 * The eye beside a password box.
 *
 * The name is the label and never the glyph: a screen reader, and the tests,
 * ask for "Show the password". A page with two boxes names each one, because
 * two buttons with one name cannot be told apart.
 */
export function RevealButton({
  shown,
  onToggle,
  what = "the password",
}: {
  shown: boolean;
  onToggle: () => void;
  what?: string;
}) {
  return (
    <button
      type="button"
      className={styles.reveal}
      aria-pressed={shown}
      aria-label={`${shown ? "Hide" : "Show"} ${what}`}
      onClick={onToggle}
    >
      <EyeIcon struck={shown} />
    </button>
  );
}

/** A hairline eye, drawn like the board's own glyphs. Struck means hide. */
export function EyeIcon({ struck }: { struck: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M1.6 8c1.6-2.6 3.7-3.9 6.4-3.9S12.8 5.4 14.4 8c-1.6 2.6-3.7 3.9-6.4 3.9S3.2 10.6 1.6 8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {struck && (
        <path
          d="M3.2 12.8 12.8 3.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
