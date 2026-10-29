"use client";

import { useMemo, useState } from "react";
import { archiveOrder, narrowArchive } from "@/lib/archive";
import { formatDate, fullTime, longAgo } from "@/lib/board";
import { todayIn } from "@/lib/day";
import { api } from "@/lib/client";
import { DELETE_WINDOW_DAYS, daysLeft, saysLeft } from "@/lib/deleted";
import type { ArchivedTaskDTO, BoardData, DeletedTaskDTO } from "@/lib/types";
import { BoardProvider, useBoard } from "@/components/board/store";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Form";
import { Card, EmptyState, PageHead, PageShell, Section, TaskLine } from "@/components/ui/Layout";
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
  const days = useMemo(
    () => byDay(rows, data.project.timeZone, data.today),
    [rows, data.project.timeZone, data.today],
  );

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
      <ProjectBar project={data.project} here="Archived" user={user} />

      <PageShell>
        {/* The count is the archived list's own. The deleted list below says
            its own count by its heading, so no number stands over two lists. */}
        <PageHead
          title="Archived"
          count={
            all.length > 0 ? (
              <span data-testid="archive-count">
                {query.trim() ? `${rows.length} of ${all.length}` : all.length}
              </span>
            ) : null
          }
          lead="Tasks taken off the board. Each keeps its values, checklist and comments, and goes back where it was."
        />

        <div className={styles.section}>
          {all.length > 0 && (
            <Input
              className={styles.find}
              block
              aria-label="Find an archived task by its key or its title"
              data-testid="archive-find"
              placeholder="Find by key or title"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}

          {all.length === 0 ? (
            <Card>
              <EmptyState title="Nothing is archived">
                Archive a task from its panel, or a whole column from the <b>↓</b> in its header.
              </EmptyState>
            </Card>
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState title="No archived task by those words">
                The box reads the key and the title, which are the two things a row shows.
              </EmptyState>
            </Card>
          ) : (
            days.map((day) => (
              <div key={day.day} className={styles.day} data-testid="archive-day">
                <Label suppressHydrationWarning>{day.said}</Label>
                <Card>
                  {day.rows.map((task) => (
                    <ArchiveRow key={task.id} task={task} now={now} />
                  ))}
                </Card>
              </div>
            ))
          )}
        </div>

        {/* Nothing deleted, no section. An empty drawer is a thing nobody has
            to be told about. */}
        {deleted.length > 0 && (
          <div className={styles.deleted} data-testid="deleted-section">
            <Section
              title="Deleted"
              note={<span data-testid="deleted-count">{deletedCount(deleted.length)}</span>}
            >
              <span className={styles.lead}>
                Off every board, list and search. Put one back within {DELETE_WINDOW_DAYS} days and
                it returns whole, with its key. After that it goes for good.
              </span>
              <Card>
                {deleted.map((task) => (
                  <DeletedRow key={task.id} task={task} now={now} onPutBack={putBack} />
                ))}
              </Card>
            </Section>
          </div>
        )}
      </PageShell>

      <Toasts toasts={toasts} />
    </div>
  );
}

/**
 * The rows under the day each went, in the project's zone, so the server and
 * the browser cut the days in the same place. A ship archives a whole column
 * in one moment, and "Archived 4 minutes ago" on every row of it said one
 * thing four times; the day says it once.
 */
function byDay(rows: ArchivedTaskDTO[], timeZone: string, today: string) {
  const days: { day: string; said: string; rows: ArchivedTaskDTO[] }[] = [];
  for (const task of rows) {
    const day = todayIn(timeZone, new Date(task.archivedAt));
    const last = days[days.length - 1];
    if (last?.day === day) last.rows.push(task);
    else days.push({ day, said: daySaid(day, today), rows: [task] });
  }
  return days;
}

function daySaid(day: string, today: string): string {
  if (day === today) return "Today";
  const before = new Date(`${today}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  if (day === before.toISOString().slice(0, 10)) return "Yesterday";
  const year = day.slice(0, 4);
  return year === today.slice(0, 4) ? formatDate(day) : `${formatDate(day)}, ${year}`;
}

/** From this many days left down, the count wears the warning colour. */
const SOON_DAYS = 7;

function deletedCount(n: number): string {
  return `${n} ${n === 1 ? "task" : "tasks"}`;
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

  /* The key and the title open the task, exactly as a list row does, and
     the panel there is the one every other screen opens. The moment is drawn
     on the server and again here, so it counts rather than reads a calendar.
     Putting a task back is the undo, not a loss, so it asks nothing first.
     The row goes when the board answers. */
  return (
    <TaskLine
      data-testid="archive-row"
      taskKey={task.key}
      title={task.title}
      href={`/p/${data.project.id}?task=${task.key}`}
      meta={
        <span
          title={`Archived ${fullTime(task.archivedAt, data.project.timeZone)}`}
          suppressHydrationWarning
        >
          {longAgo(task.archivedAt, now)}
        </span>
      }
      action={
        <Button
          variant="text"
          busy={putting}
          data-testid="archive-put-back"
          aria-label={`Put ${task.key} back`}
          onClick={async () => {
            /* The row goes only when the board comes back, so the press has
               to say it was heard. A restore that fails leaves the row, and
               the button has to work again. */
            setPutting(true);
            const back = await restoreTask(task.id);
            setPutting(false);
            if (back) notify(`${task.key} is back on the board.`, "info");
          }}
        >
          Put back
        </Button>
      }
    />
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

  /* How long is left is the one number that is about to run out, so it is
     the one drawn as a tag. In its last week it turns amber. */
  return (
    <TaskLine
      data-testid="deleted-row"
      dim
      taskKey={task.key}
      title={
        <span className={styles.goneTitle} title="Put it back to open it">
          {task.title}
        </span>
      }
      meta={
        <>
          <span suppressHydrationWarning>Deleted {longAgo(task.deletedAt, now)}</span>
          <span
            className={`${styles.left} ${daysLeft(task.goesAt, now) <= SOON_DAYS ? styles.soon : ""}`}
            suppressHydrationWarning
          >
            {saysLeft(task.goesAt, now)}
          </span>
        </>
      }
      action={
        <Button
          variant="text"
          busy={putting}
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
      }
    />
  );
}
