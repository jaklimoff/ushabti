import { version } from "../../../package.json";
import { BrandMark } from "./Marks";
import styles from "./ui.module.css";

/**
 * The app's outside: the sign-in pages and the status pages hang one column
 * from the same height on the same glow, because two outsides read as two
 * sites. Each page brings its own card content, and sets the gaps inside it,
 * because the content differs; the brand above it is `OutsideBrand`, always.
 */
export function OutsideFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.frame}>
      <div className={styles.frameColumn}>{children}</div>
      {/* A page that asks for a password says whose it is. The version is
          read once, at build, so it is the build that answers. */}
      <footer className={styles.frameFoot}>Ushabti {version} · self-hosted</footer>
    </main>
  );
}

/** The card's box: padding, ground, line and radius. */
export const outsideCard = styles.frameCard;

/**
 * The lockup above every outside card: the mark, the name, and one line that
 * says what Ushabti is. Sign-in, register, forgot, an invite, a reset and the
 * status pages all draw this one, so the brand sits at one height and one size
 * on all of them. It was drawn twice, at two gaps.
 *
 * The line under the name is who we are, not a pitch. A signed-out visit to
 * `/` lands on Sign in, so a teammate given the URL decides there; one line
 * tells them they are in the right place and costs a returning person nothing.
 */
export function OutsideBrand() {
  return (
    <div className={styles.outsideBrand}>
      <BrandMark size={32} />
      <div className={styles.outsideName}>Ushabti</div>
      <p className={styles.outsidePitch}>
        A task board where people and AI agents work the same tasks.
      </p>
    </div>
  );
}
