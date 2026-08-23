import Link from "next/link";
import styles from "./ui.module.css";

/**
 * The one shape for "this page is not the page you wanted": not found, a
 * server error, and a root layout error. The three used to be two files of
 * inline styles that disagreed with each other and with the rest of the app.
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
    <div className={styles.status}>
      <div className={styles.statusInner}>
        <div className={styles.statusMark}>U</div>
        <div className={styles.statusTitle}>{title}</div>
        <div className={styles.statusBody}>{children}</div>
        {digest && (
          <div className={styles.statusBody}>
            Look for <span className={styles.statusDigest}>{digest}</span> in the server log.
          </div>
        )}
        <div className={styles.statusActions}>
          {action}
          {href && <Link href={href}>{hrefLabel}</Link>}
        </div>
      </div>
    </div>
  );
}
