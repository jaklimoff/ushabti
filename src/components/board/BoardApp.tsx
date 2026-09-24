"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { taskByAddress } from "@/lib/board";
import type { BoardData } from "@/lib/types";

/** What opening a task needs: which one, and the key its link carries. */
type Openable = { id: string; key: string };
import { ProjectSwitcher } from "@/components/ui/ProjectSwitcher";
import { UserMenu, type SessionUser } from "@/components/ui/UserMenu";
import { Toasts } from "@/components/ui/Toasts";
import { BoardCanvas } from "./BoardCanvas";
import { FilterChips } from "./Filters";
import { ListCanvas } from "./ListCanvas";
import { Listening } from "./Listening";
import { Search } from "./Search";
import { Selection } from "./Selection";
import { BoardProvider, useBoard } from "./store";
import { TaskPanel } from "./TaskPanel";
import { ViewStrip } from "./ViewStrip";
import styles from "./board.module.css";

/** The open task’s key, in the address bar, so the link is ready to paste. */
function writeAddress(key: string | null) {
  const url = new URL(window.location.href);
  if (key) url.searchParams.set("task", key);
  else url.searchParams.delete("task");
  window.history.replaceState(null, "", url.toString());
}

export function BoardApp({
  initial,
  user,
  initialTask,
}: {
  initial: BoardData;
  user: SessionUser;
  /** What the query said: a task key, or the uuid an older link carries. */
  initialTask: string | null;
}) {
  return (
    <BoardProvider initial={initial} user={user}>
      <BoardShell initialTask={initialTask} />
    </BoardProvider>
  );
}

function BoardShell({ initialTask }: { initialTask: string | null }) {
  const { data, user, view, live, toasts, groupProperty, filters, lens, visibleTasks, setLens } =
    useBoard();
  /* A link to an archived task opens its panel, and the board behind it still
     does not draw the card. So the address is answered from both lists. */
  const [selected, setSelected] = useState<string | null>(
    () => taskByAddress([...data.tasks, ...data.archived], initialTask)?.id ?? null,
  );
  /* The chip line and the two buttons above it are on two rows but are one
     control, so the row can hold its space open while somebody is choosing.
     Without it the first answer pushes the whole board down a line under the
     panel that is still open. */
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  /* The task itself arrives, not its id, because the query carries the key a
     person reads on the card and only the task knows it. An archived task is
     carried light, so this asks for the two parts every one of them has. */
  const open = useCallback((task: Openable | null) => {
    setSelected(task?.id ?? null);
    writeAddress(task?.key ?? null);
  }, []);

  // TaskPanel builds its loader from this, so a new function on every render
  // would make the panel reload — and reset — every time the board re-renders.
  const closePanel = useCallback(() => open(null), [open]);

  /* A task that another person removed must not keep the panel open. The board
     answers that here rather than in an effect, so the panel is never drawn one
     more time on a task that has already gone. An archived one is not removed:
     it keeps its panel, and its way back. */
  const removed =
    selected !== null &&
    !data.tasks.some((t) => t.id === selected) &&
    !data.archived.some((t) => t.id === selected);
  const openTask = removed ? null : selected;

  /* The address still names the task that went. Only the address bar is
     written here; what the panel shows was decided above. */
  useEffect(() => {
    if (removed) writeAddress(null);
  }, [removed]);

  return (
    <div className={styles.shell}>
      <div className={styles.main}>
        {/* The bar itself is named, so a test that measures what hangs out
            of it holds the bar and not whatever the mark sits in. */}
        <div className={styles.top} data-testid="top-bar">
          {/* The mark is inside the button, so a phone that hides the name
              still has something to press. */}
          <ProjectSwitcher project={data.project}>
            <div className={styles.mark} data-testid="board-mark">
              {data.project.key.slice(0, 1)}
            </div>
            <span className={styles.crumbName} data-testid="board-crumb">
              {data.project.name}
            </span>
          </ProjectSwitcher>
          <span className={styles.crumbSep}>/</span>
          <span className={styles.crumbView}>{view?.name ?? "Board"}</span>
          <div className={styles.spacer} />
          {/* What is picked belongs to no view either, so it stands beside the
              search box and not in the strip. It is here only while something
              is picked. It is told whether a task is open, because Escape puts
              away one thing and the open task is the nearer one. */}
          <Selection taskOpen={openTask !== null} />
          {/* The box searches the project, so it sits above the view strip
              rather than in it, beside the things that belong to no view. */}
          <Search onOpenTask={open} />
          <Listening />
          <span
            className={live ? styles.liveDot : styles.liveDotOff}
            data-testid={live ? "live-dot" : "live-dot-off"}
            title={live ? "Live: changes from others arrive by themselves" : "Not live right now"}
          />
          {/* The two project pages, beside each other because they are the
              two places off the board. A 26 px ⚙ was the only route to
              settings, and the only pictograph in an otherwise geometric
              set. */}
          <Link
            className={styles.iconLink}
            href={`/p/${data.project.id}/archived`}
            title="The tasks that are archived"
          >
            Archive
          </Link>
          <Link
            className={styles.iconLink}
            href={`/p/${data.project.id}/settings/properties`}
            title="Project settings"
          >
            Settings
          </Link>
          <UserMenu user={user} />
        </div>

        <ViewStrip
          filterOpen={filterOpen}
          setFilterOpen={setFilterOpen}
          sortOpen={sortOpen}
          setSortOpen={setSortOpen}
        />
        <FilterChips panelOpen={filterOpen || sortOpen} />
        {/* The same tasks, drawn two ways. Everything above and below this line
            is the view's, whichever shape it takes. */}
        {view?.kind === "list" ? (
          <ListCanvas selectedTaskId={openTask} onOpenTask={open} />
        ) : (
          <BoardCanvas selectedTaskId={openTask} onOpenTask={open} />
        )}

        {/* The project has tasks; this view is hiding all of them. Saying so
            is the difference between a filter and a board that looks broken. */}
        {data.tasks.length > 0 && visibleTasks.length === 0 && (
          <div className={styles.filterBlank}>
            <div className={styles.filterBlankInner}>
              <span>
                No task passes {filters.rules.length === 1 ? "the filter" : "all the filters"}.
              </span>
              {/* Only the rules this person added. A rule of the view belongs
                  to the whole board, and it goes through the question its own
                  chip asks rather than through a button on an empty screen. */}
              {lens.rules.length > 0 && (
                <button className={styles.ghost} onClick={() => void setLens([])}>
                  Clear {lens.rules.length === 1 ? "your filter" : "your filters"}
                </button>
              )}
            </div>
          </div>
        )}

        {data.tasks.length === 0 && (
          <div className={styles.firstHint}>
            <div className={styles.firstHintInner}>
              {view?.kind === "list" ? (
                <>
                  The columns of a list are what a card carries, which you arrange in{" "}
                  <Link href={`/p/${data.project.id}/settings/card`}>Settings</Link>. Every field on
                  a task is a property of yours — Status, Priority, Assignee and the rest — so you
                  can rename or delete any of them.
                </>
              ) : (
                <>
                  The columns come from a property called <b>{groupProperty?.name ?? "Status"}</b>.
                  So do Priority, Assignee and the rest — every field on a task is yours to rename
                  or delete in{" "}
                  <Link href={`/p/${data.project.id}/settings/properties`}>Settings</Link>.
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {openTask && <TaskPanel taskId={openTask} onClose={closePanel} />}

      <Toasts toasts={toasts} />
    </div>
  );
}
