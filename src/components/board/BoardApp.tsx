"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { taskByAddress } from "@/lib/board";
import type { BoardData, TaskDTO } from "@/lib/types";
import { UserMenu, type SessionUser } from "@/components/ui/UserMenu";
import { Toasts } from "@/components/ui/Toasts";
import { BoardCanvas } from "./BoardCanvas";
import { FilterChips } from "./Filters";
import { ListCanvas } from "./ListCanvas";
import { Search } from "./Search";
import { BoardProvider, useBoard } from "./store";
import { TaskPanel } from "./TaskPanel";
import { ViewStrip } from "./ViewStrip";
import styles from "./board.module.css";

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
  const { data, user, view, live, toasts, groupProperty, filters, visibleTasks, setFilters } =
    useBoard();
  const [selected, setSelected] = useState<string | null>(
    () => taskByAddress(data.tasks, initialTask)?.id ?? null,
  );
  /* The chip line and the Filter button are on two rows but are one control,
     so the row can hold its space open while somebody is choosing. */
  const [filterOpen, setFilterOpen] = useState(false);

  /* The task itself arrives, not its id, because the query carries the key a
     person reads on the card and only the task knows it. */
  const open = useCallback((task: TaskDTO | null) => {
    setSelected(task?.id ?? null);
    const url = new URL(window.location.href);
    if (task) url.searchParams.set("task", task.key);
    else url.searchParams.delete("task");
    window.history.replaceState(null, "", url.toString());
  }, []);

  // TaskPanel builds its loader from this, so a new function on every render
  // would make the panel reload — and reset — every time the board re-renders.
  const closePanel = useCallback(() => open(null), [open]);

  /* a task that another person removed must not keep the panel open */
  useEffect(() => {
    if (selected && !data.tasks.some((t) => t.id === selected)) open(null);
  }, [data.tasks, open, selected]);

  return (
    <div className={styles.shell}>
      <div className={styles.main}>
        <div className={styles.top}>
          <div className={styles.mark}>{data.project.key.slice(0, 1)}</div>
          <span className={styles.crumbName}>{data.project.name}</span>
          <span className={styles.crumbSep}>/</span>
          <span className={styles.crumbView}>{view?.name ?? "Board"}</span>
          <div className={styles.spacer} />
          {/* The box searches the project, so it sits above the view strip
              rather than in it, beside the things that belong to no view. */}
          <Search onOpenTask={open} />
          <span
            className={live ? styles.liveDot : styles.liveDotOff}
            data-testid={live ? "live-dot" : "live-dot-off"}
            title={live ? "Live: changes from others arrive by themselves" : "Not live right now"}
          />
          {/* A 26 px ⚙ was the only route to settings, and the only
              pictograph in an otherwise geometric set. */}
          <Link
            className={styles.iconLink}
            href={`/p/${data.project.id}/settings/properties`}
            title="Project settings"
          >
            Settings
          </Link>
          <UserMenu user={user} />
        </div>

        <ViewStrip filterOpen={filterOpen} setFilterOpen={setFilterOpen} />
        <FilterChips panelOpen={filterOpen} />
        {/* The same tasks, drawn two ways. Everything above and below this line
            is the view's, whichever shape it takes. */}
        {view?.kind === "list" ? (
          <ListCanvas selectedTaskId={selected} onOpenTask={open} />
        ) : (
          <BoardCanvas selectedTaskId={selected} onOpenTask={open} />
        )}

        {/* The project has tasks; this view is hiding all of them. Saying so
            is the difference between a filter and a board that looks broken. */}
        {data.tasks.length > 0 && visibleTasks.length === 0 && (
          <div className={styles.filterBlank}>
            <div className={styles.filterBlankInner}>
              <span>
                No task passes {filters.rules.length === 1 ? "the filter" : "all the filters"}.
              </span>
              <button className={styles.ghost} onClick={() => void setFilters([])}>
                Clear the filter
              </button>
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

      {selected && <TaskPanel taskId={selected} onClose={closePanel} />}

      <Toasts toasts={toasts} />
    </div>
  );
}
