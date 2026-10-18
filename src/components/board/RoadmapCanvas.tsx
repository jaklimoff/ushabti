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
} from "react";
import { formatDate } from "@/lib/board";
import { allowedColumns } from "@/lib/filters";
import {
  daysIn,
  nextStart,
  readyToShip,
  roadmapAxis,
  roadmapMonths,
  roadmapRows,
  roadmapState,
  type RoadmapMonth,
  type RoadmapRow,
  type RoadmapState,
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
/* A count goes inside a bar only where it has room to be read. */
const COUNT_ROOM = 72;
/* One character of the 10.5px mono the dates are set in. */
const MONO_CH = 6.4;

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

/** The last day of a bar, in words: the day it shipped, or its target. */
export function endOf(row: RoadmapRow): string {
  return row.shippedAt ? `Shipped ${formatDate(row.shippedAt)}` : formatDate(row.end);
}

/** "1 task archived · 2 of 4 tasks done": what a row holds, in words. */
export function countOf(row: RoadmapRow, unit: (total: number) => string): string {
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
 * line of days. Nothing here drags, and the dates are edited in Settings,
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

  const settings = `/p/${data.project.id}/settings/properties`;
  if (!groupProperty || !drawable) {
    return (
      <div className={styles.roadmapBlank} data-testid="roadmap-view">
        A roadmap draws the options of a select property. Pick one for this view in{" "}
        <Link href={`/p/${data.project.id}/settings/views`}>Settings</Link>.
      </div>
    );
  }

  const unit = (total: number) => (countBy ? countBy.name : total === 1 ? "task" : "tasks");
  const word = nounOf(groupProperty.name);
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

  const today = at(data.today) + day / 2;
  const monthLabels = labelMonths(months, day);

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
                  style={{ left: m.left, width: m.width }}
                >
                  <span className={styles.roadmapMonthName}>{m.text}</span>
                </span>
              ))}
              <div className={styles.roadmapWeeks} aria-hidden>
                {axis.weeks.map((week, i) => (
                  <span key={week} className={styles.roadmapWeek} style={{ left: i * 7 * day }}>
                    {7 * day >= 18 ? Number(week.slice(8)) : ""}
                  </span>
                ))}
              </div>
              <span className={styles.roadmapTodayTag} style={{ left: today }}>
                {formatDate(data.today)}
              </span>
            </div>
          </div>

          {/* The month lines run down through every row, under the bars. */}
          <div className={styles.roadmapMonthLines} aria-hidden>
            {monthLabels
              .filter((m) => m.line)
              .map((m) => (
                <span key={m.key} style={{ left: m.left }} />
              ))}
          </div>

          {drawn.map((row) => {
            const said = countOf(row, unit);
            const left = at(row.start);
            const width = at(row.end) - left + day;
            const state = roadmapState(row, data.today);
            const ready = readyToShip(row, data.today);
            const counted = !row.shippedAt && row.total > 0;
            const inBar = counted && width >= COUNT_ROOM;
            const count = `${row.done}/${row.total}`;
            const end = [endOf(row), stateWords(state), counted && !inBar ? count : ""]
              .filter(Boolean)
              .join(" · ");
            /* The words go after the bar, or before it where the axis ends. */
            const before = left + width + 6 + end.length * MONO_CH > track;
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
            const spoken = stateWords(state);
            return (
              <Fragment key={row.id}>
                <div
                  className={[
                    styles.roadmapRow,
                    row.shippedAt ? styles.roadmapShipped : "",
                    state.kind === "ended" ? styles.roadmapEnded : "",
                    state.kind === "late" ? styles.roadmapLate : "",
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
                    <button
                      type="button"
                      className={styles.roadmapBar}
                      style={{ left, width, "--c": row.color } as CSSProperties}
                      aria-label={`${row.name}: ${formatDate(row.start)} to ${endOf(row)}${
                        spoken ? `, ${spoken}` : ""
                      }, ${said}`}
                      title={`${formatDate(row.start)} – ${endOf(row)}`}
                      aria-expanded={openOptionId === row.id}
                      data-testid="roadmap-bar"
                      data-option={row.id}
                      onClick={() => onOpenOption(row.id)}
                    >
                      <span
                        className={styles.roadmapFill}
                        style={{ width: `${row.share * 100}%` }}
                      />
                      {inBar && (
                        <span className={styles.roadmapBarCount} aria-hidden>
                          {count}
                        </span>
                      )}
                    </button>
                    {/* Off screen, the chip at the edge carries the date instead. */}
                    {!off && (
                      <span
                        className={styles.roadmapEnd}
                        style={before ? { right: track - left + 6 } : { left: left + width + 6 }}
                      >
                        {end}
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
          {groupProperty.type === "select" && (
            <AddRelease key={view?.id} word={word} first={rows.length === 0} onDraft={setDraft} />
          )}

          <div
            className={styles.roadmapToday}
            style={{ "--rm-x": `${today}px` } as CSSProperties}
            title={`Today, ${formatDate(data.today)}`}
            data-testid="roadmap-today"
          />
        </div>

        {rows.length === 0 && groupProperty.options.length > 0 && (
          <div className={styles.roadmapBlank}>
            Or give an option of {groupProperty.name} a target date in{" "}
            <Link href={settings}>Settings</Link>.
          </div>
        )}
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
  onDraft,
}: {
  word: string;
  first: boolean;
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

  if (!open) {
    return (
      <div className={styles.roadmapAddRow} data-testid="roadmap-add">
        <div className={styles.roadmapAddStrip}>
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
          {first && <span className={styles.roadmapAddLead}>No {word} yet</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.roadmapAddRow} data-testid="roadmap-add">
      <div className={styles.roadmapAddStrip} role="group" aria-label={`New ${word}`}>
        {first && (
          <p className={styles.roadmapAddLead}>
            No {word} yet. Name the first one and say when it is due.
          </p>
        )}
        <input
          ref={nameRef}
          className={styles.roadmapAddBox}
          aria-label={`Name of the new ${word}`}
          placeholder="Name"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <input
          ref={targetRef}
          type="date"
          className={`${styles.roadmapAddBox} ${styles.roadmapAddDate}`}
          aria-label={`Target date of the new ${word}`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className={styles.primary} onClick={() => void commit()}>
          Add {word}
        </button>
        <button type="button" className={styles.ghost} onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  );
}
