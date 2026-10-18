"use client";

import Link from "next/link";
import { longAgo } from "@/lib/board";
import type { ListGroup } from "@/lib/lists";
import { ButtonPageLink } from "@/components/ui/Button";
import { EmptyState, PageHead, PageShell } from "@/components/ui/Layout";
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
}: {
  user: SessionUser;
  list: { id: string; name: string };
  groups: ListGroup[];
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
          <EmptyState title="Nothing on this list yet">
            Add a project to it, and the rules that pick its tasks.
          </EmptyState>
        )}

        {groups.map((group) => (
          <section key={group.projectId} className={styles.group} data-testid="list-group">
            <div className={styles.groupHead}>
              <span className={styles.key}>{group.key}</span>
              <span className={styles.groupName}>{group.name}</span>
              <span className={styles.groupCount}>{group.count}</span>
              <span className={styles.rules}>{group.rules.join(" or ")}</span>
            </div>
            {group.rows.length === 0 ? (
              <p className={styles.none}>No task passes these rules.</p>
            ) : (
              <ul className={styles.rows}>
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/p/${row.projectId}?task=${row.key}`}
                      className={styles.row}
                      data-testid="list-row"
                    >
                      <span className={styles.rowKey}>{row.key}</span>
                      <span className={styles.rowTitle}>{row.title}</span>
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
                      <span className={styles.age} suppressHydrationWarning>
                        {longAgo(row.createdAt, now)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
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
