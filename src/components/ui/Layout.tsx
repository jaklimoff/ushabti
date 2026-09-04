"use client";

import styles from "./ui.module.css";

export function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.h2}>{title}</h2>
        {note && <span className={styles.note}>{note}</span>}
        {action && (
          <>
            <span className={styles.spacer} />
            {action}
          </>
        )}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={[styles.card, className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

/* The ref goes through so that a row can be dragged: dnd-kit needs the node
   itself, and a settings row is still one of these and not a second kind. */
export function Row({ children, className, ...rest }: React.ComponentPropsWithRef<"div">) {
  return (
    <div {...rest} className={[styles.row, className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

/** The band at the bottom of a card that holds the add form. */
export function Foot({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={[styles.foot, className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

export function Spacer() {
  return <span className={styles.spacer} />;
}

export function Tag({
  children,
  accent = false,
  title,
}: {
  children: React.ReactNode;
  accent?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`${styles.tag} ${accent ? styles.tagAccent : styles.tagNeutral}`}
    >
      {children}
    </span>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <span className={styles.note}>{children}</span>;
}

export function EmptyState({
  title,
  children,
  mark = "◆",
}: {
  title: string;
  children?: React.ReactNode;
  mark?: string;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>
        <span className={styles.emptyMark}>{mark}</span>
        {title}
      </span>
      {children && <span className={styles.emptyBody}>{children}</span>}
    </div>
  );
}
