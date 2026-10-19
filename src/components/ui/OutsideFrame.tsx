import styles from "./ui.module.css";

/**
 * The app's outside: the sign-in pages and the status pages hang one column
 * from the same height on the same glow, because two outsides read as two
 * sites. Each page brings its own brand and card content, and sets the gaps
 * inside them, because the content differs.
 */
export function OutsideFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.frame}>
      <div className={styles.frameColumn}>{children}</div>
    </main>
  );
}

/** The card's box: padding, ground, line and radius. */
export const outsideCard = styles.frameCard;
