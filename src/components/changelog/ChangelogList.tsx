"use client";

import { CHANGELOG_PAGE, shippedSaid } from "@/lib/changelog";
import { Markdown } from "@/components/board/Markdown";
import { ButtonPageLink } from "@/components/ui/Button";
import { Label } from "@/components/ui/Form";
import { Card, TaskLine } from "@/components/ui/Layout";
import styles from "./changelog.module.css";

const several = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "✓ Oct 1, 2026" as the rail draws it: the day, then the year below. */
function dayAndYear(said: string): [string, string | null] {
  const day = said.replace(/^✓ /, "");
  const cut = day.lastIndexOf(", ");
  return cut < 0 ? [day, null] : [day.slice(0, cut), day.slice(cut + 2)];
}

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
      {entries.map((entry, i) => {
        const [day, year] = dayAndYear(shippedSaid(entry));
        /* The year is drawn where it changes, and only read out elsewhere:
           thirteen releases of one year said "2026" thirteen times. */
        const sameYear = i > 0 && year !== null && entries[i - 1].shippedAt.slice(0, 4) === year;
        return (
          <section
            key={`${entry.name}-${i}`}
            className={`${styles.entry} ${i === 0 ? styles.newest : ""}`}
            data-testid="changelog-entry"
          >
            {/* The day stays in view while its release scrolls past, and the
                dot on the line is where the release sits in time. The year
                is its own line on the rail; on a phone the three run on one
                line, so the comma is drawn there only. */}
            <div className={styles.rail}>
              <time className={styles.when} dateTime={entry.shippedAt} data-testid="changelog-day">
                <span className={styles.whenDay}>
                  <span className={styles.tick}>✓</span> {day}
                </span>
                {year && (
                  <>
                    <span className={styles.whenComma}>, </span>
                    <span className={`${styles.whenYear} ${sameYear ? styles.yearSame : ""}`}>
                      {year}
                    </span>
                  </>
                )}
              </time>
              <span className={styles.dot} aria-hidden />
            </div>
            {/* One card is one release, so a release with only a note still
                reads as a whole. The name is what a reader scans for, so it
                is the heading, and the count is a label over the rows. */}
            <Card className={styles.card}>
              <div className={styles.entryHead}>
                <h2 className={styles.name}>{entry.name}</h2>
                {entry.tasks.length > 0 && (
                  <Label className={styles.count}>{several(entry.tasks.length, "task")}</Label>
                )}
              </div>
              {entry.note && (
                <div className={styles.note}>
                  <Markdown text={entry.note} testId="changelog-note" />
                </div>
              )}
              {entry.tasks.length > 0 && (
                <div className={styles.tasks}>
                  {entry.tasks.map((task, j) => (
                    <TaskLine
                      key={task.key ?? j}
                      className={styles.row}
                      data-testid="changelog-task"
                      taskKey={projectId ? task.key : undefined}
                      title={task.title}
                      href={projectId && task.key ? `/p/${projectId}?task=${task.key}` : undefined}
                    />
                  ))}
                </div>
              )}
            </Card>
          </section>
        );
      })}
      {older > 0 && (
        <div className={styles.older}>
          <ButtonPageLink
            variant="ghost"
            href={`${path}?shown=${entries.length + CHANGELOG_PAGE}`}
            scroll={false}
            data-testid="changelog-older"
          >
            Older releases ({older})
          </ButtonPageLink>
        </div>
      )}
    </>
  );
}
