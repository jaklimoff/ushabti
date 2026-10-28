"use client";

import { longAgo } from "@/lib/board";
import type { ListGroup } from "@/lib/lists";
import { ButtonPageLink } from "@/components/ui/Button";
import { Card, EmptyState, PageHead, PageShell, TaskLine } from "@/components/ui/Layout";
import { ProjectMark } from "@/components/ui/Marks";
import type { SessionUser } from "@/components/ui/UserMenu";
import { AppBar, AppCrumb } from "@/components/ui/AppBar";
import { useNow } from "@/components/ui/useElapsed";
import styles from "./lists.module.css";

/**
 * One list, grouped by project. A row is a link to the task on its own
 * board, and nothing here edits anything: the board is where work moves.
 */
export function ListPage({
  user,
  list,
  groups,
  colors = {},
}: {
  user: SessionUser;
  list: { id: string; name: string };
  groups: ListGroup[];
  /** Each project's colour, by id, so its key reads as it does on Home. */
  colors?: Record<string, string>;
}) {
  const now = useNow(false);
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  return (
    <div className={styles.page}>
      <ListBar user={user} trail={[<AppCrumb key="here">{list.name}</AppCrumb>]} />
      <PageShell>
        <PageHead
          title={list.name}
          count={<span data-testid="list-total">{total}</span>}
          actions={
            <ButtonPageLink variant="ghost" href={`/lists/${list.id}/edit`}>
              Edit list
            </ButtonPageLink>
          }
        />

        {groups.length === 0 && (
          <Card>
            <EmptyState title="Nothing on this list yet">
              Add a project to it, and the rules that pick its tasks.
            </EmptyState>
          </Card>
        )}

        {groups.map((group) => (
          <section key={group.projectId} className={styles.group} data-testid="list-group">
            <div className={styles.groupHead}>
              <ProjectMark
                projectKey={group.key}
                color={colors[group.projectId] ?? "var(--accent)"}
              />
              <span className={styles.groupName}>{group.name}</span>
              <span className={styles.groupCount}>{group.count}</span>
              <span className={styles.rules}>{group.rules.join(" or ")}</span>
            </div>
            {group.rows.length === 0 ? (
              <p className={styles.none}>No task passes these rules.</p>
            ) : (
              <Card>
                {group.rows.map((row) => (
                  <TaskLine
                    key={row.id}
                    data-testid="list-row"
                    taskKey={row.key}
                    title={row.title}
                    href={`/p/${row.projectId}?task=${row.key}`}
                    meta={
                      <>
                        {row.waiting && (
                          <span className={styles.waiting} data-testid="list-row-waiting">
                            Waiting for you
                          </span>
                        )}
                        {row.agent && (
                          <span
                            className={styles.agent}
                            title={row.silent ? "Not heard from for a while" : "At work on it"}
                          >
                            {row.agent}
                          </span>
                        )}
                        {row.chip && (
                          <span className={styles.chip}>
                            <span
                              className={styles.dot}
                              style={{ background: row.chip.color }}
                              aria-hidden
                            />
                            {row.chip.text}
                          </span>
                        )}
                        <span suppressHydrationWarning>{longAgo(row.createdAt, now)}</span>
                      </>
                    }
                  />
                ))}
              </Card>
            )}
          </section>
        ))}
      </PageShell>
    </div>
  );
}

/**
 * The bar of a list page: the way home, where the page sits, and who is
 * signed in. The mark is the way home, so it carries the test's handle.
 */
export function ListBar({ user, trail }: { user: SessionUser; trail?: React.ReactNode[] }) {
  return <AppBar user={user} trail={trail} homeTestId="list-home" />;
}
