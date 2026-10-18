"use client";

import Link from "next/link";
import { CHANGELOG_PAGE, shippedSaid } from "@/lib/changelog";
import { Markdown } from "@/components/board/Markdown";
import { ButtonPageLink } from "@/components/ui/Button";
import { Card, Row, Tag } from "@/components/ui/Layout";
import styles from "./changelog.module.css";

const several = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

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
 *
 * **Older** is a link and not a button: the next ten are one more page of the
 * same address, so a stranger's page works with no script, and the shelf that
 * keeps it between visits keeps each length on its own. It keeps the scroll,
 * so the reader stays where they were and the new entries arrive below.
 */
export function ChangelogList({
  entries,
  older,
  path,
  projectId = null,
}: {
  entries: Entry[];
  /** How many shipped options are left below the last entry. */
  older: number;
  /** This page's address, which **Older** adds `?shown=` to. */
  path: string;
  projectId?: string | null;
}) {
  return (
    <>
      {entries.map((entry, i) => (
        <section key={`${entry.name}-${i}`} data-testid="changelog-entry">
          {/* One card is one release, so a release with only a note still
              reads as a whole, and the card is what parts two releases. */}
          <Card>
            {/* The name is what a reader scans for, so it is the heading and
                the rest of the line is quiet: how many tasks, and the day. */}
            <div className={styles.entryHead}>
              <h2 className={styles.name}>{entry.name}</h2>
              {entry.tasks.length > 0 && <Tag>{several(entry.tasks.length, "task")}</Tag>}
              <span className={styles.day} data-testid="changelog-day">
                {shippedSaid(entry)}
              </span>
            </div>
            {entry.note && (
              <div className={styles.note}>
                <Markdown text={entry.note} testId="changelog-note" />
              </div>
            )}
            {entry.tasks.length > 0 && (
              <div className={styles.tasks}>
                {entry.tasks.map((task, j) => (
                  <Row key={task.key ?? j} className={styles.row} data-testid="changelog-task">
                    {projectId && task.key ? (
                      <Link className={styles.task} href={`/p/${projectId}?task=${task.key}`}>
                        <span className={styles.key}>{task.key}</span>
                        <span className={styles.title}>{task.title}</span>
                      </Link>
                    ) : (
                      <span className={styles.title}>{task.title}</span>
                    )}
                  </Row>
                ))}
              </div>
            )}
          </Card>
        </section>
      ))}
      {older > 0 && (
        <div className={styles.older}>
          <ButtonPageLink
            variant="ghost"
            href={`${path}?shown=${entries.length + CHANGELOG_PAGE}`}
            scroll={false}
            data-testid="changelog-older"
          >
            Older
          </ButtonPageLink>
        </div>
      )}
    </>
  );
}
