"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { formatDate } from "@/lib/board";
import { allowedColumns } from "@/lib/filters";
import { daysIn, roadmapAxis, roadmapRows, type RoadmapRow } from "@/lib/roadmap";
import { useBoard } from "./store";
import styles from "./board.module.css";
import { isSelect } from "@/lib/types";

/** The width of one day on the axis. A week is seven of them. */
const DAY_PX = 10;

/**
 * The rows a roadmap draws, through the view's filters. The canvas and the
 * panel a bar opens both ask this, so the two cannot disagree on a row.
 */
export function useRoadmap() {
  const { data, visibleTasks, groupProperty, filters, user } = useBoard();

  /* The same rule the column header reads, so a release reads one way. */
  const countBy = data.properties.find((p) => p.id === data.project.progressBy) ?? null;
  const rows = useMemo(
    () =>
      groupProperty
        ? roadmapRows(
            groupProperty,
            data.tasks,
            visibleTasks,
            { doneWhen: data.project.doneWhen, countBy: countBy?.id ?? null },
            data.project.timeZone,
            data.archivedUnder,
          )
        : [],
    [groupProperty, data.tasks, visibleTasks, data.project, countBy, data.archivedUnder],
  );
  /* A filter on the roadmap's own property takes its rows with it, exactly as
     it takes a board's columns: a row it excludes could only read 0 of 0. */
  const drawn = useMemo(
    () =>
      allowedColumns(
        rows.map((row) => ({ ...row, value: row.id })),
        filters,
        groupProperty,
        data.today,
        user.id,
      ),
    [rows, filters, groupProperty, data.today, user.id],
  );
  return { rows, drawn, countBy };
}

/** The last day of a bar, in words: the day it shipped, or its target. */
export function endOf(row: RoadmapRow): string {
  return row.shippedAt ? `Shipped ${formatDate(row.shippedAt)}` : formatDate(row.end);
}

/** Where the cursor goes back to when the panel a bar opened closes. */
export function focusBar(optionId: string) {
  document
    .querySelector<HTMLElement>(
      `[data-testid="roadmap-bar"][data-option="${CSS.escape(optionId)}"]`,
    )
    ?.focus();
}

/**
 * The roadmap.
 *
 * One row per option of a select that has a target date, and one bar on a
 * line of weeks. Nothing here drags, and the dates are edited in Settings,
 * where the option lives. A bar is a button: pressing it opens the option's
 * tasks in the panel, which the board shell draws beside the view.
 */
export function RoadmapCanvas({
  openOptionId,
  onOpenOption,
}: {
  openOptionId: string | null;
  onOpenOption: (optionId: string) => void;
}) {
  const { data, view, groupProperty } = useBoard();
  const { rows, drawn, countBy } = useRoadmap();
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);

  const axis = useMemo(() => roadmapAxis(drawn, data.today), [drawn, data.today]);

  /* Open with today in view, a third of the way in, so what is coming has
     more room than what is over. Once per view: a read of the board must not
     throw somebody back while they look at last month. */
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const line = todayRef.current;
    if (!scroller || !line) return;
    // The names are held at the left, so the axis starts after them.
    const names = scroller.querySelector<HTMLElement>(`.${styles.roadmapCorner}`)?.offsetWidth ?? 0;
    const room = scroller.clientWidth - names;
    scroller.scrollLeft = Math.max(0, line.offsetLeft - names - room / 3);
  }, [view?.id]);

  const settings = `/p/${data.project.id}/settings/properties`;
  if (!groupProperty || !isSelect(groupProperty.type)) {
    return (
      <div className={styles.roadmapBlank} data-testid="roadmap-view">
        A roadmap draws the options of a select property. Pick one for this view in{" "}
        <Link href={`/p/${data.project.id}/settings/views`}>Settings</Link>.
      </div>
    );
  }

  const unit = (total: number) => (countBy ? countBy.name : total === 1 ? "task" : "tasks");
  const track = axis.weeks.length * 7 * DAY_PX;
  const at = (day: string) => daysIn(axis, day) * DAY_PX;

  return (
    <div className={styles.roadmap} data-testid="roadmap-view">
      <div className={styles.roadmapScroll} ref={scrollRef}>
        <div className={styles.roadmapGrid} style={{ "--rm-track": `${track}px` } as CSSProperties}>
          <div className={styles.roadmapHead}>
            <div className={styles.roadmapCorner}>{groupProperty.name}</div>
            <div className={styles.roadmapTrack} data-testid="roadmap-axis">
              {axis.weeks.map((week, i) => {
                const newMonth = i === 0 || week.slice(5, 7) !== axis.weeks[i - 1].slice(5, 7);
                return (
                  <span
                    key={week}
                    className={`${styles.roadmapWeek} ${newMonth ? styles.roadmapWeekMonth : ""}`}
                    style={{ left: i * 7 * DAY_PX }}
                  >
                    {formatDate(week)}
                  </span>
                );
              })}
            </div>
          </div>

          {drawn.map((row) => {
            /* The archived ones are counted apart: a board carries no values
               for them, so no filter can reach them. */
            const said = [
              row.archived
                ? `${row.archived} ${row.archived === 1 ? "task" : "tasks"} archived`
                : "",
              row.total || !row.archived
                ? `${row.done} of ${row.total} ${unit(row.total)} done`
                : "",
            ]
              .filter(Boolean)
              .join(" · ");
            const left = at(row.start);
            const width = at(row.end) - left + DAY_PX;
            const end = endOf(row);
            return (
              <div
                key={row.id}
                className={`${styles.roadmapRow} ${row.shippedAt ? styles.roadmapShipped : ""}`}
                data-testid="roadmap-row"
              >
                <div className={styles.roadmapName}>
                  <span className={styles.roadmapSwatch} style={{ background: row.color }} />
                  <span className={styles.roadmapWords}>
                    <span className={styles.roadmapTitle} title={row.name}>
                      {row.name}
                    </span>
                    <span className={styles.roadmapCount}>{said}</span>
                  </span>
                </div>
                <div className={styles.roadmapTrack}>
                  <button
                    type="button"
                    className={styles.roadmapBar}
                    style={{ left, width, borderColor: row.color }}
                    aria-label={`${row.name}: ${formatDate(row.start)} to ${end}, ${said}`}
                    title={`${formatDate(row.start)} – ${end}`}
                    aria-expanded={openOptionId === row.id}
                    data-testid="roadmap-bar"
                    data-option={row.id}
                    onClick={() => onOpenOption(row.id)}
                  >
                    <span
                      className={styles.roadmapFill}
                      style={{ width: `${row.share * 100}%`, background: row.color }}
                    />
                  </button>
                  <span className={styles.roadmapEnd} style={{ left: left + width + 6 }}>
                    {end}
                  </span>
                </div>
              </div>
            );
          })}

          <div
            ref={todayRef}
            className={styles.roadmapToday}
            style={{ "--rm-x": `${at(data.today) + DAY_PX / 2}px` } as CSSProperties}
            title={`Today, ${formatDate(data.today)}`}
            data-testid="roadmap-today"
          />
        </div>

        {rows.length === 0 && (
          <div className={styles.roadmapBlank}>
            No option of {groupProperty.name} has a target date yet. Give one a date in{" "}
            <Link href={settings}>Settings</Link>.
          </div>
        )}
      </div>
    </div>
  );
}
