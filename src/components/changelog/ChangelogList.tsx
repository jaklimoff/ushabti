"use client";

import Link from "next/link";
import { shippedSaid } from "@/lib/changelog";
import { Markdown } from "@/components/board/Markdown";
import styles from "./changelog.module.css";

/** A task under a shipped option. The key is there only for a member. */
type Shown = { title: string; key?: string };

type Entry = {
  name: string;
  shippedAt: string;
  note: string | null;
  tasks: Shown[];
};

/**
 * The record, drawn once for both readers. A member's rows open the task; a
 * stranger's rows are words only, because the board behind them is closed to
 * that reader. Which one it is follows from the data: the public answer has
 * no keys, so it cannot draw a link.
 */
export function ChangelogList({
  entries,
  projectId = null,
}: {
  entries: Entry[];
  projectId?: string | null;
}) {
  return (
    <>
      {entries.map((entry, i) => (
        <section key={`${entry.name}-${i}`} className={styles.entry} data-testid="changelog-entry">
          <div className={styles.entryHead}>
            <h2 className={styles.name}>{entry.name}</h2>
            <span className={styles.day} data-testid="changelog-day">
              {shippedSaid(entry)}
            </span>
          </div>
          {entry.note && <Markdown text={entry.note} testId="changelog-note" />}
          {entry.tasks.length > 0 && (
            <ul className={styles.tasks}>
              {entry.tasks.map((task, j) => (
                <li key={task.key ?? j} data-testid="changelog-task">
                  {projectId && task.key ? (
                    <Link className={styles.task} href={`/p/${projectId}?task=${task.key}`}>
                      <span className={styles.key}>{task.key}</span>
                      <span>{task.title}</span>
                    </Link>
                  ) : (
                    task.title
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
