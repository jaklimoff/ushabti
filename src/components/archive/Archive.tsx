"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { archiveOrder, narrowArchive } from "@/lib/archive";
import { longAgo } from "@/lib/board";
import type { ArchivedTaskDTO, BoardData } from "@/lib/types";
import { BoardProvider, useBoard } from "@/components/board/store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form";
import { Card, EmptyState, Row } from "@/components/ui/Layout";
import { ProjectBar } from "@/components/ui/ProjectBar";
import { Toasts } from "@/components/ui/Toasts";
import { useNow } from "@/components/ui/useElapsed";
import type { SessionUser } from "@/components/ui/UserMenu";
import styles from "./archive.module.css";

/**
 * The drawer.
 *
 * A task that is archived is on no board and in no list, and until now a
 * search and its own link were the two ways back to one — enough to find a
 * task you can name, and nothing at all for one you cannot. This page is the
 * list of them, newest first, with one press that puts one back.
 *
 * It asks the server nothing. The browser already carries the archived tasks
 * beside the live ones, light — the key, the title, the rank and the moment —
 * because a search reads them and a link opens them. This page draws the same
 * rows. The day a board pages, the archive becomes a query, and so does this.
 */
export function Archive({ initial, user }: { initial: BoardData; user: SessionUser }) {
  return (
    <BoardProvider initial={initial} user={user}>
      <Screen />
    </BoardProvider>
  );
}

function Screen() {
  const { data, user, toasts } = useBoard();
  const [query, setQuery] = useState("");

  const all = useMemo(() => archiveOrder(data.archived), [data.archived]);
  const rows = useMemo(() => narrowArchive(all, query), [all, query]);

  /* One clock, read when the page opens and not again. The words change by
     the minute at the fastest, and a list is no place for a ticker: forty rows
     redrawn every second is the noise a card already refused. */
  const now = useNow(false);

  return (
    <div className={styles.page}>
      <ProjectBar project={data.project} here="Archive" user={user} />

      <div className={styles.shell}>
        <div className={styles.head}>
          <h1 className={styles.h1}>Archive</h1>
          <span className={styles.lead}>
            {all.length > 0 && <b>{count(all.length)}. </b>}
            An archived task is on no board and in no list, and keeps everything else: its values,
            its checklist, its comments and its history. Put one back and it returns to the place it
            had.
          </span>
        </div>

        {all.length > 0 && (
          <Input
            className={styles.find}
            block
            aria-label="Find an archived task by its key or its title"
            data-testid="archive-find"
            placeholder="Find an archived task"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}

        {all.length === 0 ? (
          <Card>
            <EmptyState title="Nothing is archived.">
              Archive a task from its panel, or a whole column from the <b>↓</b> in its header. They
              come here, and any one of them can be put back.
            </EmptyState>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState title="No archived task by those words.">
              The box reads the key and the title, which are the two things a row shows.
            </EmptyState>
          </Card>
        ) : (
          <Card>
            {rows.map((task) => (
              <ArchiveRow key={task.id} task={task} now={now} />
            ))}
          </Card>
        )}
      </div>

      <Toasts toasts={toasts} />
    </div>
  );
}

function count(n: number): string {
  return `${n} archived ${n === 1 ? "task" : "tasks"}`;
}

/**
 * One row: what it is, when it went, and the way back.
 *
 * Who archived it is not here. An archived task is carried light and the actor
 * is not one of the words it carries; the task's own activity log says who,
 * and the row opens it.
 */
function ArchiveRow({ task, now }: { task: ArchivedTaskDTO; now: number }) {
  const { data, restoreTask, notify } = useBoard();
  const [putting, setPutting] = useState(false);

  return (
    <Row className={styles.row} data-testid="archive-row">
      {/* The key and the title open the task, exactly as a list row does, and
          the panel there is the one every other screen opens. */}
      <Link className={styles.open} href={`/p/${data.project.id}?task=${task.key}`}>
        <span className={styles.key}>{task.key}</span>
        <span className={styles.title}>{task.title}</span>
      </Link>

      {/* Drawn on the server and again here, so it counts rather than reads a
          calendar. */}
      <span className={styles.when} suppressHydrationWarning>
        Archived {longAgo(task.archivedAt, now)}
      </span>

      {/* Putting a task back is the undo, not a loss, so it asks nothing
          first. The row goes when the board answers. */}
      <Button
        variant="ghost"
        disabled={putting}
        data-testid="archive-put-back"
        aria-label={`Put ${task.key} back`}
        onClick={async () => {
          /* The row goes only when the board comes back, so the press has to
             say it was heard. A restore that fails leaves the row, and the
             button has to work again. */
          setPutting(true);
          const back = await restoreTask(task.id);
          setPutting(false);
          if (back) notify(`${task.key} is back on the board.`, "info");
        }}
      >
        Put back
      </Button>
    </Row>
  );
}
