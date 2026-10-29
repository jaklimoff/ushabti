"use client";

import Link from "next/link";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { formatDate, shippedOn } from "@/lib/board";
import { allowedColumns } from "@/lib/filters";
import {
  dayNumber,
  daysIn,
  daysLate,
  movedTarget,
  nextStart,
  readyToShip,
  roadmapAxis,
  roadmapMonths,
  roadmapRows,
  roadmapState,
  type RoadmapMonth,
  type RoadmapRow,
  type RoadmapState,
  weekLines,
} from "@/lib/roadmap";
import { useBoard } from "./store";
import { useAddOption } from "./useAddOption";
import { ShipButton, ShipQuestion } from "./Column";
import { useShipOffer } from "./useShipOffer";
import styles from "./board.module.css";
import { isSelect } from "@/lib/types";

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
const MONO_CH = 6.4;
/* Half of today's tag in the header, and a little air: a week label that
   close to today would sit under it. */
const TODAY_HALF = 28;

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
            data.today,
          )
        : [],
    [
      groupProperty,
      data.tasks,
      visibleTasks,
      data.project,
      countBy,
      data.archivedUnder,
      data.today,
    ],
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

/* The days a move really takes the target, once the start has stopped it. */
function heldBy(row: RoadmapRow, by: number): number {
  return dayNumber(movedTarget(row, by)) - dayNumber(row.targetAt);
}

/** The last day of a bar, in words: "✓ Oct 28" once it shipped, or its target. */
export function endOf(row: RoadmapRow): string {
  return row.shippedAt ? shippedOn(row.shippedAt) : formatDate(row.end);
}

/* The same day for a screen reader, which reads a ✓ as "check mark". */
function spokenEnd(row: RoadmapRow): string {
  return row.shippedAt ? `shipped ${formatDate(row.shippedAt)}` : formatDate(row.end);
}

/* "12 days late": a shipped bar ends on its ship day, so the slip is said. */
function lateWords(row: RoadmapRow): string {
  const late = daysLate(row);
  return late ? `${late} ${late === 1 ? "day" : "days"} late` : "";
}

/* "+6 days": how far a held end has moved from where it was. */
function movedWords(by: number): string {
  const sign = by > 0 ? "+" : "−";
  return `${sign}${Math.abs(by)} ${Math.abs(by) === 1 ? "day" : "days"}`;
}

/**
 * "1 task archived · 2 of 4 tasks done": what a row holds, in words. A count
 * by a number property names it, as the column header does.
 */
export function countOf(row: RoadmapRow, countBy: { name: string } | null): string {
  const unit = (total: number) => (countBy ? countBy.name : total === 1 ? "task" : "tasks");
  /* "0 of 0 tasks done" reads as a fault, not as a release still empty. A
     count of points can be 0 with tasks in it, so only tasks say so. */
  if (!countBy && !row.total && !row.archived) return "No tasks yet";
  /* The archived ones are counted apart: a board carries no values for them,
     so no filter can reach them. */
  return [
    row.archived ? `${row.archived} ${row.archived === 1 ? "task" : "tasks"} archived` : "",
    row.total || !row.archived ? `${row.done} of ${row.total} ${unit(row.total)} done` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/* What is said after the date: the board's "ended", or the days still left. */
function stateWords(state: RoadmapState): string {
  if (state.kind === "ended") return "ended";
  if (state.kind !== "late") return "";
  if (state.daysLeft === 0) return "due today";
  return `${state.daysLeft} ${state.daysLeft === 1 ? "day" : "days"} left`;
}

/**
 * The property's name as a word in a sentence: "Phase" reads "phase", while a
 * name somebody wrote in capitals, such as MVP, keeps them.
 */
function nounOf(name: string): string {
  const rest = name.slice(1);
  return /^[A-Z]/.test(name) && rest === rest.toLowerCase() ? name[0].toLowerCase() + rest : name;
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
 * line of days. A bar is a button: pressing it opens the option's tasks in
 * the panel, which the board shell draws beside the view. Its right end
 * drags to move the target, by whole days, and the arrow keys do the same
 * from a focused bar. Letting go writes through the option PATCH Settings
 * uses, so the roadmap decides nothing of its own; the start stays in
 * Settings.
 */
export function RoadmapCanvas({
  openOptionId,
  onOpenOption,
}: {
  openOptionId: string | null;
  onOpenOption: (optionId: string) => void;
}) {
  const { data, view, groupProperty, patchOption } = useBoard();
  const { rows, drawn, countBy } = useRoadmap();
  /* The end being moved and by how many days, before it is written. The ref
     is the truth a pointer reads between renders. */
  const [moving, setMoving] = useState<{ id: string; by: number; keys: boolean } | null>(null);
  const drag = useRef<{ id: string; x: number; by: number } | null>(null);
  /* A write is one press: until its answer comes, no end moves again. */
  const writing = useRef(false);
  const offerShip = useShipOffer();
  /* One row asks at a time, and a ship is one press: while it is out, the
     button stays away. */
  const [asking, setAsking] = useState<string | null>(null);
  const [shipping, setShipping] = useState<string | null>(null);
  /* The release being added, drawn where it will land before it is made. */
  const [draft, setDraft] = useState<{ name: string; target: string } | null>(null);
  /* The width the days have, once measured, and the day at the left edge. */
  const [room, setRoom] = useState<number | null>(null);
  const [leftDay, setLeftDay] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const drawable = !!groupProperty && isSelect(groupProperty.type);
  const preview =
    draft && groupProperty
      ? (() => {
          const start = nextStart(groupProperty, data.today);
          return { start: start > draft.target ? draft.target : start, end: draft.target };
        })()
      : null;

  /*
   * The whole plan on one screen. The axis runs from the week before the
   * first bar to the week after the last, and the days share the room there
   * is. A plan shorter than the screen is given weeks to the edge, so the
   * grid never stops short; one too long to fit scrolls.
   */
  const { axis, day } = useMemo(() => {
    const spans = preview ? [...drawn, preview] : drawn;
    const natural = roadmapAxis(spans, data.today);
    if (room === null) return { axis: natural, day: FIRST_DAY };
    const days = natural.weeks.length * 7;
    if (room / days < MIN_DAY) return { axis: natural, day: MIN_DAY };
    if (room / days <= MAX_DAY) return { axis: natural, day: room / days };
    const wider = roadmapAxis(spans, data.today, Math.ceil(room / (7 * MAX_DAY)));
    return { axis: wider, day: room / (wider.weeks.length * 7) };
    // The preview is rebuilt every render; its two days are what it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawn, data.today, room, preview?.start, preview?.end]);

  const track = axis.weeks.length * 7 * day;
  const scrolls = room !== null && track > room + 1;
  const at = (d: string) => daysIn(axis, d) * day;
  const months = useMemo(() => roadmapMonths(axis), [axis]);

  /* The names are held at the left, so the days have what is left of the
     screen. Measured before paint, so the plan never draws at a guess. */
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => {
      const names =
        scroller.querySelector<HTMLElement>(`.${styles.roadmapCorner}`)?.offsetWidth ?? 0;
      setRoom(Math.max(0, Math.floor(scroller.clientWidth - names)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [drawable]);

  /* A plan that scrolls opens with today a third of the way in, so what is
     coming has more room than what is over. Once per view: a read of the
     board must not throw somebody back while they look at last month. */
  const measured = room !== null;
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || room === null) return;
    scroller.scrollLeft = scrolls ? Math.max(0, at(data.today) - room / 3) : 0;
    setLeftDay(Math.floor(scroller.scrollLeft / day));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, measured]);

  /* Escape puts a dragged end back, wherever the pointer is. */
  const pointerDrag = !!moving && !moving.keys;
  useEffect(() => {
    if (!pointerDrag) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = null;
      setMoving(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pointerDrag]);

  const settings = `/p/${data.project.id}/settings/properties`;
  if (!groupProperty || !drawable) {
    return (
      <div className={styles.roadmapBlank} data-testid="roadmap-view">
        A roadmap draws the options of a select property. Pick one for this view in{" "}
        <Link href={`/p/${data.project.id}/settings/views`}>Settings</Link>.
      </div>
    );
  }

  const word = nounOf(groupProperty.name);
  const shippedCount = drawn.filter((r) => r.shippedAt).length;
  /* The days on screen, for the chips that point at a bar off it. */
  const lastDay = room === null ? Infinity : leftDay + room / day;

  /* Brings a bar into view: whole and centred where it fits, else its start. */
  function reveal(row: RoadmapRow) {
    const scroller = scrollRef.current;
    if (!scroller || room === null) return;
    const left = at(row.start);
    const width = at(row.end) - left + day;
    const to = width < room - 48 ? left - (room - width) / 2 : left - 24;
    scroller.scrollTo({ left: Math.max(0, to), behavior: "smooth" });
  }

  /* Whole pixels, so the 1px line never smears to grey. */
  const today = Math.round(at(data.today) + day / 2);
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

  /* Only somebody the option PATCH would answer may drag, and a shipped
     release keeps the day it shipped. */
  const movable = (row: RoadmapRow) => data.project.mayStructure && !row.shippedAt;

  async function write(row: RoadmapRow, by: number) {
    drag.current = null;
    setMoving(null);
    if (by === 0 || writing.current) return;
    const targetAt = movedTarget(row, by);
    if (targetAt === row.targetAt) return;
    writing.current = true;
    try {
      await patchOption(row.id, { targetAt });
    } finally {
      writing.current = false;
    }
  }

  function grab(e: PointerEvent<HTMLElement>, row: RoadmapRow) {
    if (e.button !== 0 || writing.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: row.id, x: e.clientX, by: 0 };
    setMoving({ id: row.id, by: 0, keys: false });
  }

  function pull(e: PointerEvent<HTMLElement>, row: RoadmapRow) {
    const held = drag.current;
    if (!held || held.id !== row.id) return;
    const by = Math.round((e.clientX - held.x) / day);
    /* Past the start the date stops, so the count stops with it. */
    const kept = heldBy(row, by);
    if (kept === held.by) return;
    held.by = kept;
    setMoving({ id: row.id, by: kept, keys: false });
  }

  function onBarKey(e: KeyboardEvent<HTMLButtonElement>, row: RoadmapRow) {
    if (!movable(row)) return;
    const held = moving?.id === row.id && moving.keys ? moving.by : null;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      if (writing.current) return;
      const step = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 7 : 1);
      setMoving({ id: row.id, by: heldBy(row, (held ?? 0) + step), keys: true });
      return;
    }
    if (held === null) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void write(row, held);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMoving(null);
    }
  }

  return (
    <div className={styles.roadmap} data-testid="roadmap-view">
      <div
        className={styles.roadmapScroll}
        ref={scrollRef}
        onScroll={(e) => setLeftDay(Math.floor(e.currentTarget.scrollLeft / day))}
      >
        <div
          className={styles.roadmapGrid}
          data-measured={measured || undefined}
          style={
            {
              "--rm-track": `${track}px`,
              "--rm-week": `${7 * day}px`,
            } as CSSProperties
          }
        >
          <div className={styles.roadmapHead}>
            <div className={styles.roadmapCorner}>{groupProperty.name}</div>
            <div className={styles.roadmapTrack} data-testid="roadmap-axis">
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
                {formatDate(data.today)}
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

          {/* Before the rows, so the words after a bar stand over it while
              the bars stay under it. */}
          <div
            className={styles.roadmapToday}
            style={{ "--rm-x": `${today}px` } as CSSProperties}
            title={`Today, ${formatDate(data.today)}`}
            data-testid="roadmap-today"
          />

          {drawn.map((drawnRow, i) => {
            /* A moved end is drawn where it will land: the bar, its date and
               its words all read the day it is held at. */
            const held = moving?.id === drawnRow.id ? moving : null;
            const row = held
              ? (() => {
                  const end = movedTarget(drawnRow, held.by);
                  return { ...drawnRow, end, targetAt: end };
                })()
              : drawnRow;
            const said = countOf(row, countBy);
            const left = at(row.start);
            const width = at(row.end) - left + day;
            const state = roadmapState(row, data.today);
            const ready = readyToShip(row, data.today);
            const spoken = stateWords(state);
            const late = lateWords(row);
            /* What is said after the bar. The count is said once, in the name
               cell, which stays on screen when the bar does not. */
            const words: { text: string; className?: string; chip?: boolean }[] = [
              {
                text: endOf(row),
                className: held
                  ? styles.roadmapEndDate
                  : row.shippedAt
                    ? styles.roadmapEndShipped
                    : undefined,
              },
            ];
            if (held) {
              if (held.by !== 0)
                words.push({ text: movedWords(held.by), className: styles.roadmapEndMoved });
              if (held.keys)
                words.push({
                  text: "Enter to save, Esc to undo",
                  className: styles.roadmapEndHint,
                });
            } else if (late) {
              words.push({ text: late });
            } else if (state.kind === "ended") {
              words.push({ text: spoken, className: styles.roadmapEndChip, chip: true });
            } else if (spoken) {
              words.push({ text: spoken });
            }
            const widthOf = (ws: typeof words) =>
              ws.reduce(
                (sum, w, i) =>
                  sum + w.text.length * MONO_CH + (i ? 3 * MONO_CH : 0) + (w.chip ? 12 : 0),
                0,
              );
            const fitsAfter = (ws: typeof words) => left + width + 6 + widthOf(ws) <= track;
            const fitsBefore = (ws: typeof words) => left - 6 - widthOf(ws) >= 0;
            /* The words go after the bar, or before it where the axis ends and
               there is room. Where neither side has room, as on a phone, the
               last words go first and the date stays: words that flipped
               anyway slid under the names. The bar's label still says all. */
            let shown = words;
            while (shown.length > 1 && !fitsAfter(shown) && !fitsBefore(shown))
              shown = shown.slice(0, -1);
            const before = !fitsAfter(shown) && fitsBefore(shown);
            const startDay = daysIn(axis, row.start);
            const endDay = daysIn(axis, row.end) + 1;
            const off = !scrolls
              ? null
              : endDay < leftDay + 2
                ? "left"
                : startDay > lastDay - 2
                  ? "right"
                  : null;
            /* A row has a target or it is not drawn, so only a shipped one
               offers nothing. */
            const ship = row.shippedAt ? null : offerShip(row);
            return (
              <Fragment key={row.id}>
                {/* `roadmapRows` keeps the shipped rows below the open ones,
                    which breaks the run of dates; the label says why. */}
                {row.shippedAt && !drawn[i - 1]?.shippedAt && (
                  <div className={styles.roadmapDivider} data-testid="roadmap-shipped">
                    <span className={styles.roadmapDividerName}>Shipped · {shippedCount}</span>
                  </div>
                )}
                <div
                  className={[
                    styles.roadmapRow,
                    row.shippedAt ? styles.roadmapShipped : "",
                    state.kind === "ended" ? styles.roadmapEnded : "",
                    state.kind === "late" ? styles.roadmapLate : "",
                    ready ? styles.roadmapReady : "",
                  ].join(" ")}
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
                    {ship && shipping !== row.id && (
                      <ShipButton
                        testId="roadmap-ship"
                        className={styles.roadmapShip}
                        closing={ship.closing}
                        name={row.name}
                        ready={ready}
                        expanded={asking === row.id}
                        onClick={() => setAsking(asking === row.id ? null : row.id)}
                      />
                    )}
                  </div>
                  <div className={styles.roadmapTrack}>
                    {/* The day it was due, on a release that shipped after it. */}
                    {late && (
                      <span
                        className={styles.roadmapTarget}
                        style={{ left: Math.round(at(row.targetAt) + day) }}
                        aria-hidden
                      />
                    )}
                    <button
                      type="button"
                      className={styles.roadmapBar}
                      style={{ left, width, "--c": row.color } as CSSProperties}
                      aria-label={`${row.name}: ${formatDate(row.start)} to ${spokenEnd(row)}${
                        spoken ? `, ${spoken}` : ""
                      }${late ? `, ${late}` : ""}, ${said}`}
                      title={`${formatDate(row.start)} – ${endOf(row)}`}
                      aria-expanded={openOptionId === row.id}
                      data-testid="roadmap-bar"
                      data-option={row.id}
                      aria-keyshortcuts={movable(row) ? "ArrowLeft ArrowRight" : undefined}
                      onClick={() => onOpenOption(row.id)}
                      onKeyDown={(e) => onBarKey(e, drawnRow)}
                      onBlur={() => {
                        /* Leaving the bar keeps the date, as a field saves on blur. */
                        if (held?.keys) void write(drawnRow, held.by);
                      }}
                    >
                      <span
                        className={styles.roadmapFill}
                        style={{ width: `${row.share * 100}%` }}
                      />
                      {late && (
                        <span
                          className={styles.roadmapSlip}
                          style={{ left: at(row.targetAt) + day - left }}
                        />
                      )}
                    </button>
                    {/* Where a held end was, so the move reads against it. */}
                    {held && held.by !== 0 && (
                      <span
                        className={styles.roadmapWas}
                        style={{ left: Math.round(at(drawnRow.end) + day) }}
                        aria-hidden
                      />
                    )}
                    {movable(row) && (
                      <span
                        className={styles.roadmapGrip}
                        style={{ left: left + width - 7 }}
                        title="Drag to move the target date"
                        aria-hidden
                        data-testid="roadmap-grip"
                        data-held={held ? "" : undefined}
                        onPointerDown={(e) => grab(e, drawnRow)}
                        onPointerMove={(e) => pull(e, drawnRow)}
                        onPointerUp={() => {
                          if (drag.current?.id === drawnRow.id)
                            void write(drawnRow, drag.current.by);
                        }}
                        onPointerCancel={() => {
                          drag.current = null;
                          setMoving(null);
                        }}
                      />
                    )}
                    {/* Off screen, the chip at the edge carries the date instead. */}
                    {!off && (
                      <span
                        data-testid="roadmap-end"
                        data-held={held ? "" : undefined}
                        className={styles.roadmapEnd}
                        style={before ? { right: track - left + 6 } : { left: left + width + 6 }}
                      >
                        {shown.map((w, i) => (
                          <Fragment key={i}>
                            {i > 0 && (w.chip ? " " : <span aria-hidden> · </span>)}
                            <span className={w.className}>{w.text}</span>
                          </Fragment>
                        ))}
                      </span>
                    )}
                    {off && (
                      <span
                        className={`${styles.roadmapOffLayer} ${
                          off === "right" ? styles.roadmapOffRight : ""
                        }`}
                      >
                        <button
                          type="button"
                          className={styles.roadmapOff}
                          aria-label={`Scroll to ${row.name}`}
                          onClick={() => reveal(row)}
                        >
                          {off === "left" ? `‹ ${endOf(row)}` : `${formatDate(row.start)} ›`}
                        </button>
                      </span>
                    )}
                  </div>
                </div>
                {/* The board has no dialogs, so the question opens in place,
                  under the row it is about. */}
                {ship && asking === row.id && (
                  <ShipQuestion
                    name={row.name}
                    optionId={row.id}
                    doneWhen={data.project.doneWhen}
                    ship={ship}
                    className={`${styles.roadmapAsk} ${styles.colHeadAsking}`}
                    onCancel={() => setAsking(null)}
                    onPick={(rest, strays) => {
                      setAsking(null);
                      setShipping(row.id);
                      /* The board is read again before the answer comes, so a
                       shipped row already hides the button by its date. */
                      void ship.onShip(rest, strays).finally(() => setShipping(null));
                    }}
                  />
                )}
              </Fragment>
            );
          })}

          {preview && (
            <div className={`${styles.roadmapRow} ${styles.roadmapDraft}`} aria-hidden>
              <div className={styles.roadmapName}>
                <span className={styles.roadmapSwatch} />
                <span className={styles.roadmapWords}>
                  <span className={styles.roadmapTitle}>{draft?.name.trim() || `New ${word}`}</span>
                  <span className={styles.roadmapCount}>
                    {formatDate(preview.start)} – {formatDate(preview.end)}
                  </span>
                </span>
              </div>
              <div className={styles.roadmapTrack}>
                <span
                  className={styles.roadmapDraftBar}
                  style={{
                    left: at(preview.start),
                    width: at(preview.end) - at(preview.start) + day,
                  }}
                />
              </div>
            </div>
          )}

          {/* A sprint comes from the cadence, so a sprint roadmap offers none. */}
          {groupProperty.type === "select" ? (
            <AddRelease
              key={view?.id}
              word={word}
              first={rows.length === 0}
              undated={groupProperty.options.length > 0}
              settings={settings}
              range={preview ? `${formatDate(preview.start)} – ${formatDate(preview.end)}` : null}
              onDraft={setDraft}
            />
          ) : (
            rows.length === 0 && (
              <div className={styles.roadmapFirst}>
                <p className={styles.roadmapFirstLead}>No {word} has dates yet.</p>
                <p className={styles.roadmapFirstSaid}>
                  Give one a start and a target in <Link href={settings}>Settings</Link>.
                </p>
              </div>
            )
          )}

          {/* The names column runs to the bottom with the lines beside it. */}
          <div className={styles.roadmapRest} aria-hidden>
            <div className={styles.roadmapName} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A release made where releases are seen. It is the board's new column with a
 * target date: the same route, and Enter, as a column is added. A row needs a
 * target to be drawn, so both boxes are asked for. It is named after the
 * property, because a roadmap of phases has no releases on it.
 */
function AddRelease({
  word,
  first,
  undated,
  settings,
  range,
  onDraft,
}: {
  word: string;
  first: boolean;
  /** Options exist, and none has a target: Settings can date one instead. */
  undated: boolean;
  settings: string;
  /** "Nov 21 – Dec 18": the days the release will take, once a target is picked. */
  range: string | null;
  onDraft: (draft: { name: string; target: string } | null) => void;
}) {
  const add = useAddOption();
  /* With nothing on the roadmap yet, the form is the page, so it starts open. */
  const [open, setOpen] = useState(first);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const saving = useRef(false);
  const opened = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  /* A target is where the row will land, so it is drawn while it is picked. */
  useEffect(() => {
    onDraft(open && target ? { name, target } : null);
  }, [open, name, target, onDraft]);
  useEffect(() => () => onDraft(null), [onDraft]);

  /* Opened by a press, the cursor goes to the name; open on arrival, it
     waits, because a page that takes the focus on load takes it from the
     search. */
  useEffect(() => {
    if (open && opened.current) nameRef.current?.focus();
  }, [open]);

  function close() {
    setName("");
    setTarget("");
    setOpen(false);
  }

  async function commit() {
    if (saving.current) return;
    const trimmed = name.trim();
    if (!trimmed) return nameRef.current?.focus();
    if (!target) return targetRef.current?.focus();
    saving.current = true;
    try {
      if (await add(trimmed, { targetAt: target })) {
        setName("");
        setTarget("");
        nameRef.current?.focus();
      }
    } finally {
      saving.current = false;
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const newButton = (
    <button
      type="button"
      className={styles.roadmapAddButton}
      onClick={() => {
        opened.current = true;
        setOpen(true);
      }}
    >
      <span aria-hidden className={styles.roadmapAddPlus}>
        +
      </span>
      New {word}
    </button>
  );

  const form = (
    <div className={styles.roadmapAddForm} role="group" aria-label={`New ${word}`}>
      <label className={styles.roadmapAddField}>
        <span className={styles.roadmapAddLabel}>Name</span>
        <input
          ref={nameRef}
          className={styles.roadmapAddBox}
          aria-label={`Name of the new ${word}`}
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <label className={styles.roadmapAddField}>
        <span className={styles.roadmapAddLabel}>Target date</span>
        <input
          ref={targetRef}
          type="date"
          className={`${styles.roadmapAddBox} ${styles.roadmapAddDate}`}
          aria-label={`Target date of the new ${word}`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <div className={styles.roadmapAddActions}>
        {/* The start that will be written, said the way every date here is. */}
        {range && <span className={styles.roadmapAddRange}>{range}</span>}
        <button type="button" className={styles.ghost} onClick={close}>
          Cancel
        </button>
        <button type="button" className={styles.primary} onClick={() => void commit()}>
          Add {word}
        </button>
      </div>
    </div>
  );

  /* The empty roadmap is one block: what is missing, and the way to add it. */
  if (first) {
    return (
      <div className={styles.roadmapAddRow} data-testid="roadmap-add">
        <div className={styles.roadmapFirst}>
          <p className={styles.roadmapFirstLead}>
            {undated ? `No ${word} has a target date yet.` : `No ${word} yet.`}
          </p>
          <p className={styles.roadmapFirstSaid}>
            {undated ? (
              <>
                Add one here, or give one a target date in <Link href={settings}>Settings</Link>.
              </>
            ) : (
              "Name the first one and say when it is due."
            )}
          </p>
          {open ? form : newButton}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.roadmapAddRow} data-testid="roadmap-add">
      {open ? (
        <div className={styles.roadmapAddStrip}>{form}</div>
      ) : (
        <div className={styles.roadmapName}>{newButton}</div>
      )}
    </div>
  );
}
