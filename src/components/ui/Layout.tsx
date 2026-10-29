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

/** What a foot says under its form, on a line of its own. */
export function FootNote({ children }: { children: React.ReactNode }) {
  return <div className={styles.footNote}>{children}</div>;
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

/**
 * Nothing here yet, and what would fill it. `action` is the way forward, when
 * the person reading can take it; it sits under the words, a step apart.
 */
export function EmptyState({
  title,
  children,
  action,
  mark = "◆",
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  mark?: string;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>
        <span className={styles.emptyMark}>{mark}</span>
        {title}
      </span>
      {children && <span className={styles.emptyBody}>{children}</span>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

const PAGE_WIDTH = {
  narrow: styles.pageNarrow,
  content: styles.pageContent,
  wide: styles.pageWide,
};

/**
 * The frame of a page off the board, under its bar. Pages used to pick their
 * own widths and top paddings, so the title moved as you went from one to the
 * next. A width is one of three names: `narrow` for one form, `content` for a
 * page of rows, `wide` for a grid.
 */
export function PageShell({
  width = "content",
  className,
  children,
}: {
  width?: keyof typeof PAGE_WIDTH;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={[styles.pageShell, PAGE_WIDTH[width], className ?? ""].filter(Boolean).join(" ")}
    >
      {children}
    </main>
  );
}

/** The title of a page, what it holds, and the one sentence that says what it is for. */
export function PageHead({
  title,
  count,
  lead,
  actions,
}: {
  title: React.ReactNode;
  count?: React.ReactNode;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className={styles.pageHead}>
      <div className={styles.pageTitleRow}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {count !== undefined && count !== null && <span className={styles.pageCount}>{count}</span>}
        {actions && <div className={styles.pageActions}>{actions}</div>}
      </div>
      {lead && <div className={styles.pageLead}>{lead}</div>}
    </div>
  );
}
