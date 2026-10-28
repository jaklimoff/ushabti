"use client";

import Link from "next/link";
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

/**
 * What a foot says under its form, on a line of its own.
 *
 * The button that commits a foot's add form is the primary one: it is the
 * act the foot is for. A named destroy act ("Delete project", "Remove
 * Builder") is `variant="danger"`, and a row's own remove is the ✕
 * `IconButton danger`. No tinted ghost buttons.
 */
export function FootNote({ children }: { children: React.ReactNode }) {
  return <div className={styles.footNote}>{children}</div>;
}

export function Spacer() {
  return <span className={styles.spacer} />;
}

/**
 * A word the app writes about a row, in the label's voice: mono capitals.
 * `dot` puts a 6 px dot of that colour before it, so a tag that stands for a
 * thing with a colour (a role, an option) differs from a type by more than
 * its tint.
 */
export function Tag({
  children,
  accent = false,
  dot,
  title,
}: {
  children: React.ReactNode;
  accent?: boolean;
  dot?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`${styles.tag} ${accent ? styles.tagAccent : styles.tagNeutral}`}
    >
      {dot && <span className={styles.dot} style={{ background: dot }} aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * One task on one line, off the board: the archive, the changelog, a list.
 * Every such row used to be built where it was used, at 36, 39 and 51 px.
 *
 * With an `href` the whole row is the link and the whole row takes the focus
 * ring; `meta` and `action` sit above the link, so a button in the row still
 * gets its own press. `dim` is a row that opens nothing, such as a deleted
 * task: it reads quieter and does not light under the pointer.
 */
export function TaskLine({
  taskKey,
  title,
  href,
  meta,
  action,
  dim = false,
  className,
  ...rest
}: Omit<React.ComponentProps<"div">, "title"> & {
  taskKey?: string;
  title: React.ReactNode;
  href?: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  dim?: boolean;
}) {
  const name = (
    <>
      {taskKey && <span className={styles.taskLineKey}>{taskKey}</span>}
      <span className={styles.taskLineTitle}>{title}</span>
    </>
  );
  return (
    <div
      {...rest}
      className={[styles.taskLine, dim ? styles.taskLineDim : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {href && !dim ? (
        <Link href={href} className={`${styles.taskLineName} ${styles.taskLineLink}`}>
          {name}
        </Link>
      ) : (
        <span className={styles.taskLineName}>{name}</span>
      )}
      {meta && <span className={styles.taskLineMeta}>{meta}</span>}
      {action && <span className={styles.taskLineAction}>{action}</span>}
    </div>
  );
}

/**
 * How much of something is done, as one 4 px bar: a checklist, a release, a
 * project's columns. The card drew it first; everything else draws the same
 * one. With a `label` it is a progressbar a screen reader hears; without, the
 * count beside it already says it and the bar is decoration.
 */
export function Meter({
  done,
  total,
  color,
  label,
  className,
}: {
  done: number;
  total: number;
  /** The fill. The accent by default; `var(--shipped)` once a release is out. */
  color?: string;
  label?: string;
  className?: string;
}) {
  const share = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <span
      className={[styles.meter, className ?? ""].filter(Boolean).join(" ")}
      {...(label
        ? {
            role: "progressbar",
            "aria-label": label,
            "aria-valuemin": 0,
            "aria-valuemax": total,
            "aria-valuenow": done,
          }
        : { "aria-hidden": true })}
    >
      <span
        className={styles.meterFill}
        style={{ width: `${share * 100}%`, ...(color ? { background: color } : {}) }}
      />
    </span>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <span className={styles.note}>{children}</span>;
}

/**
 * The end of a form that makes a thing: Cancel, then the primary, at the
 * right. The primary is never disabled because a box is empty; the form
 * checks itself on submit and says what is missing under the box.
 */
export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className={styles.formActions}>{children}</div>;
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
