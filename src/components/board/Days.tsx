"use client";

import { useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import { formatDate } from "@/lib/board";
import {
  daysIn,
  roadmapAxis,
  roadmapMonths,
  weekLines,
  type RoadmapAxis,
  type RoadmapMonth,
} from "@/lib/roadmap";
import styles from "./board.module.css";

/*
 * The line of days a roadmap and a timeline both stand on: months over weeks,
 * today's line and its tag. The axis itself comes from `roadmap.ts`; this is
 * only how it is fitted to the screen and drawn, so the two views read alike.
 */

/*
 * The width of one day. The plan is fitted to the screen between these two;
 * a plan too long to fit at the narrowest scrolls instead, because a week
 * under 28px can no longer carry its date.
 */
const MIN_DAY = 4;
const MAX_DAY = 14;
/* Before the screen is measured: the server, and the first frame. */
const FIRST_DAY = 6;
/* One character of the 10.5px mono the dates are set in. */
export const MONO_CH = 6.4;
/* Half of today's tag in the header, and a little air: a week label that
   close to today would sit under it. */
const TODAY_HALF = 28;

/**
 * The whole plan on one screen. The axis runs from the week before the first
 * span to the week after the last, and the days share the room there is. A
 * plan shorter than the screen is given weeks to the edge, so the grid never
 * stops short; one too long to fit scrolls.
 *
 * The names are held at the left, so the days have what is left of the
 * screen. Measured before paint, so the plan never draws at a guess.
 */
export function useDays(
  scrollRef: RefObject<HTMLDivElement | null>,
  spans: { start: string; end: string }[],
  today: string,
  /** The corner's class: its width is what the names take. */
  corner: string,
  /** Measured again when this changes: the grid comes and goes with it. */
  shown: boolean,
) {
  const [room, setRoom] = useState<number | null>(null);
  const key = spans.map((s) => `${s.start}~${s.end}`).join(",");

  const { axis, day } = useMemo(() => {
    const natural = roadmapAxis(spans, today);
    if (room === null) return { axis: natural, day: FIRST_DAY };
    const days = natural.weeks.length * 7;
    if (room / days < MIN_DAY) return { axis: natural, day: MIN_DAY };
    if (room / days <= MAX_DAY) return { axis: natural, day: room / days };
    const wider = roadmapAxis(spans, today, Math.ceil(room / (7 * MAX_DAY)));
    return { axis: wider, day: room / (wider.weeks.length * 7) };
    // The spans are rebuilt every render; the key is what they say.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, today, room]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => {
      const names = scroller.querySelector<HTMLElement>(`.${corner}`)?.offsetWidth ?? 0;
      setRoom(Math.max(0, Math.floor(scroller.clientWidth - names)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollRef, corner, shown]);

  const track = axis.weeks.length * 7 * day;
  return {
    axis,
    day,
    room,
    track,
    scrolls: room !== null && track > room + 1,
    measured: room !== null,
    at: (d: string) => daysIn(axis, d) * day,
  };
}

/** The grid's own variables, which the rows and the lines read. */
export function daysStyle(track: number, day: number): CSSProperties {
  return { "--rm-track": `${track}px`, "--rm-week": `${7 * day}px` } as CSSProperties;
}

/**
 * The month band, in pixels. A month says its name where it has room to; a
 * year it could not say moves on to the next month that can.
 */
function labelMonths(months: RoadmapMonth[], day: number) {
  const labels: { key: string; left: number; width: number; text: string; line: boolean }[] = [];
  let owed = false;
  for (const month of months) {
    const width = month.days * day;
    const year: boolean = month.sayYear || owed;
    const text: string = year ? `${month.name} ${month.year}` : month.name;
    const fits: boolean = width >= text.length * MONO_CH + 12;
    owed = year && !fits;
    labels.push({
      key: `${month.year}-${month.name}`,
      left: Math.max(0, month.at) * day,
      width,
      text: fits ? text : "",
      line: month.at > 0,
    });
  }
  return labels;
}

/**
 * The head of the days, the lines that run down under the rows, and today's
 * line over them. Drawn in the grid before the rows, so the words after a bar
 * stand over the line while the bars stay under it.
 */
export function Days({
  axis,
  day,
  today: todayDay,
  corner,
  lit = null,
}: {
  axis: RoadmapAxis;
  day: number;
  today: string;
  corner: React.ReactNode;
  /** The days a held bar stands on, lit on the axis so they read as dates. */
  lit?: { start: string; end: string } | null;
}) {
  const months = useMemo(() => roadmapMonths(axis), [axis]);
  /* Whole pixels, so the 1px line never smears to grey. */
  const today = Math.round(daysIn(axis, todayDay) * day + day / 2);
  const monthLabels = labelMonths(months, day);
  const monthXs = monthLabels.filter((m) => m.line).map((m) => m.left);
  const lines = weekLines(axis, months);
  /* A week says its day only where nothing covers it: today's tag, or a
     month line running through the number. */
  function weekLabel(i: number, week: string): string {
    if (7 * day < 18) return "";
    const text = String(Number(week.slice(8)));
    const x = i * 7 * day;
    const right = x + 5 + text.length * MONO_CH;
    if (today + TODAY_HALF > x && today - TODAY_HALF < right) return "";
    if (monthXs.some((m) => m > x + 1 && m < right + 4)) return "";
    return text;
  }

  return (
    <>
      <div className={styles.roadmapHead}>
        <div className={styles.roadmapCorner}>{corner}</div>
        <div className={styles.roadmapTrack} data-testid="roadmap-axis">
          {lit && (
            <span
              className={styles.daysLit}
              data-testid="days-lit"
              style={{
                left: Math.round(daysIn(axis, lit.start) * day),
                width: Math.max(
                  1,
                  Math.round((daysIn(axis, lit.end) - daysIn(axis, lit.start) + 1) * day),
                ),
              }}
              aria-hidden
            />
          )}
          {monthLabels.map((m) => (
            <span
              key={m.key}
              className={`${styles.roadmapMonth} ${m.line ? styles.roadmapMonthLine : ""}`}
              style={{ left: Math.round(m.left), width: m.width }}
            >
              <span className={styles.roadmapMonthName}>{m.text}</span>
            </span>
          ))}
          <div className={styles.roadmapWeeks} aria-hidden>
            {axis.weeks.map((week, i) => (
              <span
                key={week}
                className={`${styles.roadmapWeek} ${lines[i] ? "" : styles.roadmapWeekBare}`}
                style={{ left: Math.round(i * 7 * day) }}
              >
                {weekLabel(i, week)}
              </span>
            ))}
          </div>
          <span className={styles.roadmapTodayTag} style={{ left: today }}>
            {formatDate(todayDay)}
          </span>
        </div>
      </div>

      {/* The weeks and the months run down to the bottom of the screen,
          under the bars, so a short plan still reads as a timeline. */}
      <div className={styles.roadmapLines} aria-hidden>
        {axis.weeks.map((week, i) =>
          i > 0 && lines[i] ? (
            <span
              key={week}
              className={styles.roadmapWeekLine}
              style={{ left: Math.round(i * 7 * day) }}
            />
          ) : null,
        )}
        {monthXs.map((x) => (
          <span key={x} className={styles.roadmapMonthRule} style={{ left: Math.round(x) }} />
        ))}
      </div>

      <div
        className={styles.roadmapToday}
        style={{ "--rm-x": `${today}px` } as CSSProperties}
        title={`Today, ${formatDate(todayDay)}`}
        data-testid="roadmap-today"
      />
    </>
  );
}
