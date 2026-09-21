"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { archiveOrder, narrowArchive } from "@/lib/archive";
import { longAgo } from "@/lib/board";
import { api } from "@/lib/client";
import { DELETE_WINDOW_DAYS, saysLeft } from "@/lib/deleted";
import type { ArchivedTaskDTO, BoardData, DeletedTaskDTO } from "@/lib/types";
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
 * Below them is the other kind of gone. A deleted task is off every board,
 * list, search and count, and it comes back whole for thirty days. That list
 * is not board data and never could be — a deleted task must reach no board —
 * so the page is handed it by the server and asks for it again when it
 * changes.
 *
 * The archived rows cost nothing: the browser already carries them beside the
 * live ones, light — the key, the title, the rank and the moment — because a
 * search reads them and a link opens them. The day a board pages, the archive
 * becomes a query, and so does this.
 */
export function Archive({
  initial,
  deleted,
  user,
}: {
  initial: BoardData;
  deleted: DeletedTaskDTO[];
  user: SessionUser;
}) {
  return (
    <BoardProvider initial={initial} user={user}>
      <Screen deleted={deleted} />
    </BoardProvider>
  );
}

function Screen({ deleted: first }: { deleted: DeletedTaskDTO[] }) {
  const { data, user, toasts, undeleteTask, notify } = useBoard();
  const [query, setQuery] = useState("");
  /*
   * The server's list, and then this page's own. Nothing else on the screen
   * can move it: the stream rings about the board, and a deleted task is not
   * on it. So somebody else's delete reaches this page on the next load, as
   * a row that ran out does.
   */
  const [deleted, setDeleted] = useState(first);

  const all = useMemo(() => archiveOrder(data.archived), [data.archived]);
  const rows = useMemo(() => narrowArchive(all, query), [all, query]);

  /* One clock, read when the page opens and not again. The words change by
     the minute at the fastest, and a list is no place for a ticker: forty rows
     redrawn every second is the noise a card already refused. */
  const now = useNow(false);

  async function putBack(task: DeletedTaskDTO) {
    const back = await undeleteTask(task.id);
    if (!back) return;
    notify(`${task.key} is back, with everything on it.`, "info");
    try {
      const answer = await api.get<{ deleted: DeletedTaskDTO[] }>(
        `/api/projects/${data.project.id}/deleted`,
      );
      setDeleted(answer.deleted);
    } catch {
      /* The put back went through, so the row has to go whatever a second
         read says. */
      setDeleted((current) => current.filter((row) => row.id !== task.id));
    }
  }

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

        <div className={styles.section}>
          {/* The heading is drawn only when there are two lists. One list
              under one title does not need to be told what it is. */}
          {deleted.length > 0 && <h2 className={styles.h2}>Archived</h2>}

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
                Archive a task from its panel, or a whole column from the <b>↓</b> in its header.
                They come here, and any one of them can be put back.
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

        {/* Nothing deleted, no section. An empty drawer is a thing nobody has
            to be told about. */}
        {deleted.length > 0 && (
          <div className={styles.section} data-testid="deleted-section">
            <h2 className={styles.h2}>Deleted, gone in {DELETE_WINDOW_DAYS} days</h2>
            <span className={styles.lead}>
              A deleted task is off every board and every list, out of every search and every count.
              It comes back whole, with the key it had. After {DELETE_WINDOW_DAYS} days it goes for
              good, and its comments, its checklist and its history go with it.
            </span>
            <Card>
              {deleted.map((task) => (
                <DeletedRow key={task.id} task={task} now={now} onPutBack={putBack} />
              ))}
            </Card>
          </div>
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

/**
 * One deleted row: what it was, when it went, how long is left, and the way
 * back.
 *
 * The key and the title do not open anything. Every route about a deleted
 * task answers `404`, so a link here would be a promise the board cannot
 * keep; put it back first and it opens like any other task.
 */
function DeletedRow({
  task,
  now,
  onPutBack,
}: {
  task: DeletedTaskDTO;
  now: number;
  onPutBack: (task: DeletedTaskDTO) => Promise<void>;
}) {
  const [putting, setPutting] = useState(false);

  return (
    <Row className={`${styles.row} ${styles.dead}`} data-testid="deleted-row">
      <span className={styles.gone}>
        <span className={styles.key}>{task.key}</span>
        <span className={styles.title}>{task.title}</span>
      </span>

      <span className={styles.when} suppressHydrationWarning>
        Deleted {longAgo(task.deletedAt, now)}
      </span>

      {/* The one number that is about to run out, so it is the one that
          carries a colour. */}
      <span className={styles.left} suppressHydrationWarning>
        {saysLeft(task.goesAt, now)}
      </span>

      <Button
        variant="ghost"
        disabled={putting}
        data-testid="deleted-put-back"
        aria-label={`Put ${task.key} back`}
        onClick={async () => {
          setPutting(true);
          await onPutBack(task);
          setPutting(false);
        }}
      >
        Put back
      </Button>
    </Row>
  );
}
