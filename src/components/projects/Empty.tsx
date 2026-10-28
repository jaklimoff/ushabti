"use client";

import Link from "next/link";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./ProjectList.module.css";

/**
 * One section of Home. It alone decides between the empty panel and the small
 * button in the heading, from its own count, so the sections cannot disagree:
 * an empty section shows the panel, and its first item brings the button back.
 * `adding` hides the panel while the section's own form stands in for it.
 */
export function HomeSection({
  title,
  count,
  adding = false,
  create,
  empty,
  children,
  ...rest
}: {
  title: string;
  count: number;
  adding?: boolean;
  create: React.ReactNode;
  empty: React.ReactNode;
  children: React.ReactNode;
  "data-testid"?: string;
}) {
  return (
    <section className={styles.lists} data-testid={rest["data-testid"]}>
      <div className={styles.sectionHead}>
        <h2 className={styles.section}>{title}</h2>
        {count > 0 && <span className={styles.sectionCount}>{count}</span>}
        {count > 0 && create}
      </div>
      {count === 0 && !adding && empty}
      {children}
    </section>
  );
}

/**
 * The first thing a new person sees: what a project is, and one way to make
 * it. Somebody who signed up to join a team has nothing to make, so the panel
 * also says how they get in, with the address the owner needs.
 */
export function FirstProjectPanel({ email, onCreate }: { email: string; onCreate: () => void }) {
  const id = useId();
  return (
    <div
      className={styles.firstPanel}
      role="group"
      aria-labelledby={id}
      data-testid="first-project"
    >
      <Board />
      <h3 id={id} className={styles.panelTitle}>
        Create your first project
      </h3>
      <p className={styles.panelLine}>
        A project is one board of tasks, shared with the people and agents you invite.
      </p>
      <Button size="lg" onClick={onCreate}>
        New project
      </Button>
      <p className={styles.panelInvite}>
        Joining a team? Ask its owner to invite <span className={styles.panelEmail}>{email}</span>.
      </p>
      {/* One line, in place of two more boxes that could only say "not yet". */}
      <p className={styles.panelNote}>Lists and charts appear here once you have a project.</p>
    </div>
  );
}

/* Three columns of a board, the last one empty: what a project will look
   like, drawn in outlines as the other panels draw theirs. */
const BOARD = [2, 2, 1];

function Board() {
  return (
    <span className={styles.boardShapes} aria-hidden="true" data-testid="first-shapes">
      {BOARD.map((cards, i) => (
        <span key={i} className={styles.boardColumn}>
          <span className={styles.boardHead} />
          {Array.from({ length: cards }, (_, j) => (
            <span key={j} className={styles.boardCard} />
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * The wide panel that is itself the create link: the words on the left, a
 * small line drawing of what will come on the right. The drawing is outlines,
 * never grey blocks, so nobody takes it for something still loading.
 */
export function WidePanel({
  label,
  hint,
  shapes,
  href,
  onClick,
  disabled,
  title,
  ...rest
}: {
  label: string;
  hint: string;
  shapes: "rows" | "bars";
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  "data-testid"?: string;
}) {
  const id = useId();
  const inside = (
    <>
      <span className={styles.wideWords}>
        <span id={id} className={styles.wideLabel}>
          {label}
        </span>
        <span id={`${id}-hint`} className={styles.wideHint}>
          {hint}
        </span>
      </span>
      {shapes === "rows" ? <Rows /> : <Bars />}
    </>
  );
  const named = { "aria-labelledby": id, "aria-describedby": `${id}-hint` };
  if (href) {
    return (
      <Link href={href} className={styles.widePanel} data-testid={rest["data-testid"]} {...named}>
        {inside}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={styles.widePanel}
      data-testid={rest["data-testid"]}
      disabled={disabled}
      title={title}
      onClick={onClick}
      {...named}
    >
      {inside}
    </button>
  );
}

function Rows() {
  return (
    <span className={styles.wideShapes} aria-hidden="true" data-testid="panel-shapes">
      {[72, 56, 64].map((width, i) => (
        <span key={i} className={styles.shapeRow}>
          <span className={styles.shapeKey} />
          <span className={styles.shapeLine} style={{ width: `${width}%` }} />
        </span>
      ))}
    </span>
  );
}

const BARS = [30, 55, 40, 70, 45, 85, 60, 35, 75, 50];

function Bars() {
  return (
    <span
      className={`${styles.wideShapes} ${styles.shapeBars}`}
      aria-hidden="true"
      data-testid="panel-shapes"
    >
      {/* The last day in the accent, as a real chart draws today. */}
      {BARS.map((height, i) => (
        <span
          key={i}
          className={styles.shapeBar}
          data-today={i === BARS.length - 1 || undefined}
          style={{ height: `${height}%` }}
        />
      ))}
    </span>
  );
}
