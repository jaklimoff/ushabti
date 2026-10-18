import Link from "next/link";
import { BrandMark } from "./Marks";
import styles from "./ui.module.css";

/**
 * The one shape for "this page is not the page you wanted": not found, a
 * server error, and a root layout error. It wears the sign-in pages' frame —
 * the mark and the name above one card, hung from the same height — because
 * both are the app's outside, and two outsides read as two sites.
 */
export function StatusPage({
  title,
  children,
  digest,
  action,
  href = "/projects",
  hrefLabel = "Go to your projects",
}: {
  title: string;
  children: React.ReactNode;
  /** The string that finds this error in the server log. */
  digest?: string;
  action?: React.ReactNode;
  href?: string | null;
  hrefLabel?: string;
}) {
  return (
    <main className={styles.status}>
      <div className={styles.statusInner}>
        <div className={styles.statusBrand}>
          <BrandMark size={32} />
          <span className={styles.statusName}>Ushabti</span>
        </div>
        <section className={styles.statusCard}>
          <h1 className={styles.statusTitle}>{title}</h1>
          <p className={styles.statusBody}>{children}</p>
          {digest && (
            <p className={styles.statusBody}>
              Look for <span className={styles.statusDigest}>{digest}</span> in the server log.
            </p>
          )}
          {(action || href) && (
            <div className={styles.statusActions}>
              {action}
              {href && <Link href={href}>{hrefLabel}</Link>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
