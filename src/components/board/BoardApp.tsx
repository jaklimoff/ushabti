"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { BoardData } from "@/lib/types";
import { UserMenu, type SessionUser } from "@/components/ui/UserMenu";
import { Toasts } from "@/components/ui/Toasts";
import { BoardCanvas } from "./BoardCanvas";
import { BoardProvider, useBoard } from "./store";
import { TaskPanel } from "./TaskPanel";
import { ViewStrip } from "./ViewStrip";
import styles from "./board.module.css";

export function BoardApp({
  initial,
  user,
  initialTaskId,
}: {
  initial: BoardData;
  user: SessionUser;
  initialTaskId: string | null;
}) {
  return (
    <BoardProvider initial={initial} user={user}>
      <BoardShell initialTaskId={initialTaskId} />
    </BoardProvider>
  );
}

function BoardShell({ initialTaskId }: { initialTaskId: string | null }) {
  const { data, user, view, live, toasts, groupProperty } = useBoard();
  const [selected, setSelected] = useState<string | null>(initialTaskId);

  const open = useCallback((id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("task", id);
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

        <ViewStrip />
        <BoardCanvas selectedTaskId={selected} onOpenTask={open} />

        {data.tasks.length === 0 && (
          <div className={styles.firstHint}>
            <div className={styles.firstHintInner}>
              The columns come from a property called <b>{groupProperty?.name ?? "Status"}</b>. So
              do Priority, Assignee and the rest — every field on a task is yours to rename or
              delete in <Link href={`/p/${data.project.id}/settings/properties`}>Settings</Link>.
            </div>
          </div>
        )}
      </div>

      {selected && <TaskPanel taskId={selected} onClose={closePanel} />}

      <Toasts toasts={toasts} />
    </div>
  );
}
