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
  lead = false,
  adding = false,
  create,
  empty,
  children,
  ...rest
}: {
  title: string;
  count: number;
  lead?: boolean;
  adding?: boolean;
  create: React.ReactNode;
  empty: React.ReactNode;
  children: React.ReactNode;
  "data-testid"?: string;
}) {
  return (
    <section className={styles.lists} data-testid={rest["data-testid"]}>
      <div className={styles.sectionHead}>
        <h2 className={lead ? styles.sectionLead : styles.section}>{title}</h2>
        {lead && count > 0 && <span className={styles.sectionCount}>{count}</span>}
        {count > 0 && create}
      </div>
      {count === 0 && !adding && empty}
      {children}
    </section>
  );
}

/** The first thing a new person sees: what a project is, and one way to make it. */
export function FirstProjectPanel({ onCreate }: { onCreate: () => void }) {
  const id = useId();
  return (
    <div
      className={styles.firstPanel}
      role="group"
      aria-labelledby={id}
      data-testid="first-project"
    >
      <span className={styles.panelPlus} aria-hidden="true">
        +
      </span>
      <h3 id={id} className={styles.panelTitle}>
        Create your first project
      </h3>
      <p className={styles.panelLine}>
        A project is one board of tasks, shared with the people and agents you invite. Every list
        and chart on Home reads from your projects.
      </p>
      <Button onClick={onCreate}>New project</Button>
    </div>
  );
}

/** Nothing can be made here yet, so the panel says why and does not react. */
export function QuietPanel({ title, line }: { title: string; line: string }) {
  const id = useId();
  return (
    <div className={styles.quietPanel} role="group" aria-labelledby={id} data-testid="quiet-panel">
      <h3 id={id} className={styles.panelTitle}>
        {title}
      </h3>
      <p className={styles.panelLine}>{line}</p>
    </div>
  );
}

/**
 * The wide panel that is itself the create link: the words on the left, grey
 * shapes of what will come on the right. The shapes are decoration only.
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
      {BARS.map((height, i) => (
        <span key={i} className={styles.shapeBar} style={{ height: `${height}%` }} />
      ))}
    </span>
  );
}
