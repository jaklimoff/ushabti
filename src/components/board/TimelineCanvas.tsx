"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Chevron } from "@/components/ui/Marks";
import { formatDate, sortByPosition } from "@/lib/board";
import { cardFace, cardStripe } from "@/lib/card-view";
import { seedNote, seedValues } from "@/lib/filters";
import { startsWith } from "@/lib/when";
import { isOver } from "@/lib/links";
import { personName, personOf } from "@/lib/people";
import { sortTasks } from "@/lib/sort";
import { dayOf } from "@/lib/roadmap";
import {
  changedDates,
  lateWords,
  movedDates,
  NO_DATES,
  spanOf,
  spanWords,
  sweptDates,
  timelineRows,
  type Grip,
  type HeldDays,
  type TimelineRow,
} from "@/lib/timeline";
import type { TaskDTO } from "@/lib/types";
import { Composer } from "./Column";
import { Days, daysStyle, MONO_CH, useDays } from "./Days";
import { TimelineDatesChips } from "./TimelineDates";
import { useBoard } from "./store";
import styles from "./board.module.css";

function sameDays(a: HeldDays, b: HeldDays): boolean {
  return a.start === b.start && a.end === b.end;
}

/* A task whose card wears no stripe: the neutral grey of a built-in row. */
const NEUTRAL = "#8b8f98";

/**
 * The timeline.
 *
 * One row per task the view shows, in the order a list would draw them, and a
 * bar from the day it starts to the day it ends on the roadmap's line of
 * weeks. Which rows there are and where each bar stands is `timelineRows`';
 * this draws its answer and decides nothing. A bar, a diamond, a chip and a
 * row's name open the task, as a card does.
 *
 * A bar drags: its body moves both days, an end moves one, and a drag across
 * an empty row under Not scheduled gives it its days. Where a held bar lands
 * is `movedDates`'; letting go writes each date that changed through
 * `setValue`, as the task panel would, so the timeline decides nothing new.
 */
export function TimelineCanvas({
  selectedTaskId,
  onOpenTask,
}: {
  selectedTaskId: string | null;
  onOpenTask: (task: TaskDTO | null) => void;
}) {
  const {
    data,
    view,
    visibleTasks,
    filters,
    cardItems,
    sort,
    createTask,
    updateView,
    setValue,
    user,
  } = useBoard();
  const [folded, setFolded] = useState(false);
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /* The bar being moved and the days it will stand on, before they are
     written. The ref is the truth a pointer reads between renders. */
  const [moving, setMoving] = useState<{ id: string; days: HeldDays; keys: boolean } | null>(null);
  const drag = useRef<{
    id: string;
    grip: Grip;
    x: number;
    moved: boolean;
    days: HeldDays;
  } | null>(null);
  /* A drag of the body ends in a click on it, which must not open the task. */
  const dragged = useRef(false);
  /* A drag across an empty row: the day it was pressed on and the day under it. */
  const [sweep, setSweep] = useState<{ id: string; from: string; to: string } | null>(null);
  const sweeping = useRef<{ id: string; from: string; x: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ id: string; day: string } | null>(null);
  /* A write is one release: until its answer comes, nothing moves again. */
  const writing = useRef(false);

  const dates = view?.dates ?? NO_DATES;
  const ordered = useMemo(
    () => sortTasks(sortByPosition(visibleTasks), sort, cardItems, data.members, data.former),
    [visibleTasks, sort, cardItems, data.members, data.former],
  );
  const doneWhen = data.project.doneWhen;
  const { dated, unscheduled } = useMemo(
    () => timelineRows(ordered, dates, data.today, (t) => isOver(t, doneWhen)),
    [ordered, dates, data.today, doneWhen],
  );

  const { axis, day, track, measured, at } = useDays(
    scrollRef,
    dated.map(spanOf),
    data.today,
    styles.roadmapCorner,
    !!dates.endBy,
  );

  const face = cardFace(cardItems);

  /* Escape puts a dragged bar back, wherever the pointer is. */
  const pointerDrag = (!!moving && !moving.keys) || !!sweep;
  useEffect(() => {
    if (!pointerDrag) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = null;
      sweeping.current = null;
      setMoving(null);
      setSweep(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pointerDrag]);

  /* A timeline has no column, so the filter answers for every property, as
     a list's does. Without it the task is written and hidden at once. */
  const named = [...data.tasks, ...data.archived];
  const seed = seedValues(filters, data.properties, null, user.id, data.today, data.former, named);
  const addNote = seedNote(
    seed,
    data.properties,
    data.members,
    startsWith(data.project.typeBy, seed, data.properties),
    named,
  );

  async function commit(title: string) {
    setComposing(false);
    if (!title) return;
    const task = await createTask({
      title,
      values: seed,
      afterId: ordered.at(-1)?.id ?? null,
      atTop: false,
    });
    if (task) onOpenTask(task);
  }

  if (!view) return null;

  const endName = data.properties.find((p) => p.id === dates.endBy)?.name;
  if (!endName) {
    return (
      <div className={styles.timelineBlank} data-testid="timeline-view">
        <p className={styles.timelineBlankLead}>Pick the date the bars end on.</p>
        <div className={styles.timelineBlankPick}>
          <TimelineDatesChips
            properties={data.properties}
            dates={dates}
            onChange={(next) => void updateView(view.id, { dates: next })}
          />
        </div>
      </div>
    );
  }
  const startName = data.properties.find((p) => p.id === dates.startBy)?.name;

  /* Moving dates is content, as the task panel's date boxes are: anybody
     who may write a value may drag. A backwards row has no bar to hold. */
  const movable = (r: TimelineRow<TaskDTO>) => r.shape !== "backwards";

  /* Both values are put on the screen at once, then sent together, so the
     bar never reads backwards between the two writes. */
  async function writeDates(
    task: TaskDTO,
    was: { start: string | null; end: string | null },
    now: HeldDays,
    withStart: boolean,
  ) {
    const changes = changedDates(was, now, dates, withStart);
    if (changes.length === 0 || writing.current) return;
    writing.current = true;
    try {
      await Promise.all(changes.map((c) => setValue(task.id, c.propertyId, c.value)));
    } finally {
      writing.current = false;
    }
  }

  function write(r: TimelineRow<TaskDTO>, days: HeldDays) {
    drag.current = null;
    setMoving(null);
    return writeDates(r.task, { start: r.start, end: r.end }, days, r.shape === "bar");
  }

  function grab(e: PointerEvent<HTMLElement>, r: TimelineRow<TaskDTO>, grip: Grip) {
    dragged.current = false;
    if (e.button !== 0 || writing.current || !movable(r)) return;
    /* An end is only a grip; the body is also the button that opens the task. */
    if (grip !== "body") e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: r.task.id,
      grip,
      x: e.clientX,
      moved: false,
      days: { start: r.start, end: r.end },
    };
  }

  function pull(e: PointerEvent<HTMLElement>, r: TimelineRow<TaskDTO>) {
    const held = drag.current;
    if (!held || held.id !== r.task.id) return;
    /* A press that wanders a pixel or two is still a click. */
    if (!held.moved && Math.abs(e.clientX - held.x) < 4) return;
    held.moved = true;
    const days = movedDates(r, held.grip, Math.round((e.clientX - held.x) / day));
    if (moving?.id === r.task.id && sameDays(held.days, days)) return;
    held.days = days;
    setMoving({ id: r.task.id, days, keys: false });
  }

  function letGo(r: TimelineRow<TaskDTO>) {
    const held = drag.current;
    if (!held || held.id !== r.task.id) return;
    drag.current = null;
    if (!held.moved) return;
    dragged.current = held.grip === "body" || r.shape === "point";
    void write(r, held.days);
  }

  function drop() {
    drag.current = null;
    setMoving(null);
  }

  function open(task: TaskDTO) {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    onOpenTask(task);
  }

  /* Left and Right move the whole bar, Shift with them only its end. Enter
     writes and Escape puts it back, as on the roadmap. */
  function onBarKey(e: KeyboardEvent<HTMLButtonElement>, r: TimelineRow<TaskDTO>) {
    if (!movable(r)) return;
    const held = moving?.id === r.task.id && moving.keys ? moving.days : null;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      if (writing.current) return;
      const from = held ?? { start: r.start, end: r.end };
      const days = movedDates(
        { shape: r.shape, ...from },
        e.shiftKey ? "end" : "body",
        e.key === "ArrowRight" ? 1 : -1,
      );
      setMoving({ id: r.task.id, days, keys: true });
      return;
    }
    if (held === null) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void write(r, held);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMoving(null);
    }
  }

  /* The day under the pointer on a row's track. */
  function dayUnder(e: PointerEvent<HTMLElement>): string {
    const box = e.currentTarget.getBoundingClientRect();
    const last = axis.weeks.length * 7 - 1;
    const i = Math.min(last, Math.max(0, Math.floor((e.clientX - box.left) / day)));
    return dayOf(axis.first + i);
  }

  function sweepFrom(e: PointerEvent<HTMLElement>, task: TaskDTO) {
    if (e.button !== 0 || writing.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    sweeping.current = { id: task.id, from: dayUnder(e), x: e.clientX, moved: false };
  }

  function sweepOver(e: PointerEvent<HTMLElement>, task: TaskDTO) {
    const held = sweeping.current;
    if (!held || held.id !== task.id) {
      if (e.pointerType === "mouse" && !writing.current) {
        const at = dayUnder(e);
        if (hover?.id !== task.id || hover.day !== at) setHover({ id: task.id, day: at });
      }
      return;
    }
    if (!held.moved && Math.abs(e.clientX - held.x) < 4) return;
    held.moved = true;
    const to = dayUnder(e);
    if (sweep?.id === task.id && sweep.to === to) return;
    setSweep({ id: task.id, from: held.from, to });
  }

  function sweepEnd(e: PointerEvent<HTMLElement>, task: TaskDTO) {
    const held = sweeping.current;
    sweeping.current = null;
    setSweep(null);
    if (!held || held.id !== task.id || !held.moved) return;
    const days = sweptDates(held.from, dayUnder(e), !!dates.startBy);
    setHover(null);
    void writeDates(task, { start: null, end: null }, days, true);
  }

  /** The name cell: the title, and under it the key and the stripe's value. */
  function name(task: TaskDTO) {
    const stripe = cardStripe(cardItems, task, data.members, data.former);
    return (
      <button
        type="button"
        className={styles.roadmapName}
        data-testid="timeline-name"
        onClick={() => onOpenTask(task)}
      >
        <span className={styles.roadmapSwatch} style={{ background: stripe?.color ?? NEUTRAL }} />
        <span className={styles.roadmapWords}>
          <span className={styles.roadmapTitle} title={task.title}>
            {task.title}
          </span>
          <span className={styles.roadmapCount}>
            {task.key}
            {stripe && ` · ${stripe.word}`}
          </span>
        </span>
      </button>
    );
  }

  /* An empty row's days: the pointer over them says what a drag will do, and
     a drag across them draws the bar it will write. */
  function empty(task: TaskDTO) {
    const swept = sweep?.id === task.id ? sweptDates(sweep.from, sweep.to, !!dates.startBy) : null;
    const over = !swept && hover?.id === task.id ? hover.day : null;
    const said = dates.startBy
      ? "Drag across the days to give it a start and an end"
      : "Drag to the day it ends on";
    const left = swept ? at(swept.start) : over ? at(over) : 0;
    const width = swept ? at(swept.end) - left + day : day;
    const words = swept ? spanWords(swept, formatDate) : said;
    const before = left + width + 6 + words.length * MONO_CH > track;
    return (
      <div
        className={`${styles.roadmapTrack} ${styles.timelineEmpty}`}
        data-testid="timeline-empty"
        onPointerDown={(e) => sweepFrom(e, task)}
        onPointerMove={(e) => sweepOver(e, task)}
        onPointerUp={(e) => sweepEnd(e, task)}
        onPointerCancel={() => {
          sweeping.current = null;
          setSweep(null);
        }}
        onPointerLeave={() => {
          if (hover?.id === task.id) setHover(null);
        }}
      >
        {(swept || over) && (
          <>
            <span
              className={swept ? styles.timelineSweep : styles.timelineHoverDay}
              data-testid={swept ? "timeline-sweep" : "timeline-hover"}
              style={{ left, width }}
              aria-hidden
            />
            <span
              className={`${styles.timelineAfter} ${swept ? "" : styles.timelineHint}`}
              data-testid="timeline-hint"
              style={before ? { right: track - left + 6 } : { left: left + width + 6 }}
            >
              {words}
            </span>
          </>
        )}
      </div>
    );
  }

  function row(r: TimelineRow<TaskDTO>) {
    const task = r.task;
    const color = cardStripe(cardItems, task, data.members, data.former)?.color ?? NEUTRAL;
    const person = face?.property
      ? personOf(task.values[face.property.id], data.members, data.former)
      : null;
    /* A held bar is drawn where it will land: the bar, its days on the axis
       and its words all read the days it is held at. */
    const held = moving?.id === task.id ? moving : null;
    const shown = held?.days ?? { start: r.start, end: r.end };
    const left = at(shown.start);
    const width = at(shown.end) - left + day;
    const wasLeft = at(r.start);
    const wasWidth = at(r.end) - wasLeft + day;
    const spoken = `${task.key} ${task.title}`;

    /* What is said after the bar: the face, then the end day and its state.
       A held bar says the days it will stand on instead. */
    const said = formatDate(r.end);
    const state = r.over ? "done" : r.late ? lateWords(r.late) : "";
    const span = held ? spanWords(held.days, formatDate) : null;
    const hint = held?.keys ? "Enter to save, Esc to undo" : null;
    const words = span ? (hint ? `${span} · ${hint}` : span) : state ? `${said} · ${state}` : said;
    const wordsWidth = words.length * MONO_CH + (person ? 22 : 0);

    const hold = (grip: Grip) => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => grab(e, r, grip),
      onPointerMove: (e: PointerEvent<HTMLElement>) => pull(e, r),
      onPointerUp: () => letGo(r),
      onPointerCancel: drop,
    });
    const keys = {
      "aria-keyshortcuts": "ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight",
      onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => onBarKey(e, r),
      /* Leaving the bar keeps the days, as a field saves on blur. */
      onBlur: () => {
        if (held?.keys) void write(r, held.days);
      },
    };

    let shape: React.ReactNode;
    let after = left + width + 6;
    let start = left;
    if (r.shape === "bar") {
      const share = r.over ? 1 : r.checklist ? r.checklist.done / r.checklist.total : 0;
      shape = (
        <>
          {held && (
            <span
              className={styles.timelineGhost}
              data-testid="timeline-ghost"
              style={{ left: wasLeft, width: wasWidth }}
              aria-hidden
            />
          )}
          <button
            type="button"
            className={`${styles.roadmapBar} ${styles.timelineBar}`}
            data-testid="timeline-bar"
            data-over={r.over || undefined}
            data-movable=""
            data-held={held ? "" : undefined}
            style={{ left, width, "--c": color } as CSSProperties}
            aria-label={`${spoken}: ${formatDate(r.start)} to ${said}${state ? `, ${state}` : ""}`}
            title={`${formatDate(r.start)} – ${said}`}
            onClick={() => open(task)}
            {...hold("body")}
            {...keys}
          >
            <span className={styles.roadmapFill} style={{ width: `${share * 100}%` }} />
            {r.checklist && !r.over && (
              <span className={styles.timelineCount}>
                {r.checklist.done}/{r.checklist.total}
              </span>
            )}
          </button>
          <span
            className={`${styles.roadmapGrip} ${styles.timelineGripStart}`}
            style={{ left: left - 7 }}
            title="Drag to move the start"
            aria-hidden
            data-testid="timeline-grip-start"
            data-held={held ? "" : undefined}
            {...hold("start")}
          />
          <span
            className={styles.roadmapGrip}
            style={{ left: left + width - 7 }}
            title="Drag to move the end"
            aria-hidden
            data-testid="timeline-grip-end"
            data-held={held ? "" : undefined}
            {...hold("end")}
          />
        </>
      );
    } else if (r.shape === "point") {
      const x = left + day / 2;
      after = x + 12;
      start = x - 8;
      shape = (
        <>
          {held && (
            <span
              className={`${styles.timelineGhost} ${styles.timelineGhostPoint}`}
              data-testid="timeline-ghost"
              style={{ left: wasLeft + day / 2 }}
              aria-hidden
            />
          )}
          <button
            type="button"
            className={styles.timelineDiamond}
            data-testid="timeline-point"
            data-over={r.over || undefined}
            data-movable=""
            data-held={held ? "" : undefined}
            style={{ left: x, "--c": color } as CSSProperties}
            aria-label={`${spoken}: ${said}${state ? `, ${state}` : ""}`}
            title={said}
            onClick={() => open(task)}
            {...hold("body")}
            {...keys}
          />
        </>
      );
    } else {
      const text = `Starts ${formatDate(r.said ?? r.end)}, after its end ${said}`;
      const chipWidth = (text.length + 3) * MONO_CH + 12;
      return (
        <div
          key={task.id}
          className={styles.roadmapRow}
          data-testid="timeline-row"
          data-open={selectedTaskId === task.id || undefined}
        >
          {name(task)}
          <div className={styles.roadmapTrack}>
            <button
              type="button"
              className={styles.timelineBackwards}
              data-testid="timeline-backwards"
              style={left + chipWidth > track ? { right: 4 } : { left }}
              onClick={() => onOpenTask(task)}
            >
              <span aria-hidden>! </span>
              {text}
            </button>
          </div>
        </div>
      );
    }

    /* After the bar where the axis has room, else before it. */
    const before = after + wordsWidth > track && start - 6 - wordsWidth >= 0;
    return (
      <div
        key={task.id}
        className={styles.roadmapRow}
        data-testid="timeline-row"
        data-open={selectedTaskId === task.id || undefined}
      >
        {name(task)}
        <div className={styles.roadmapTrack}>
          {shape}
          <span
            className={styles.timelineAfter}
            data-testid="timeline-end"
            data-held={held ? "" : undefined}
            style={before ? { right: track - start + 6 } : { left: after }}
          >
            {person && (
              <Avatar
                name={personName(person)}
                color={person.color}
                emoji={person.emoji}
                kind={person.kind}
                gone={person.gone}
                size={16}
              />
            )}
            {span ? (
              <>
                <span>{span}</span>
                {hint && (
                  <>
                    <span aria-hidden> · </span>
                    <span className={styles.timelineHint}>{hint}</span>
                  </>
                )}
              </>
            ) : (
              <span>{said}</span>
            )}
            {!span && state && (
              <>
                <span aria-hidden> · </span>
                <span className={r.over ? undefined : styles.timelineLate}>{state}</span>
              </>
            )}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.roadmap} ${styles.timeline}`} data-testid="timeline-view">
      <div className={styles.roadmapScroll} ref={scrollRef}>
        <div
          className={styles.roadmapGrid}
          data-measured={measured || undefined}
          style={daysStyle(track, day)}
        >
          <Days
            axis={axis}
            day={day}
            today={data.today}
            lit={moving?.days ?? (sweep ? sweptDates(sweep.from, sweep.to, !!dates.startBy) : null)}
            corner={
              <>
                Task
                <span className={styles.timelineCornerDates}>
                  {" · "}
                  {startName ? `${startName} → ${endName}` : endName}
                </span>
              </>
            }
          />

          {dated.map(row)}

          {unscheduled.length > 0 && (
            <>
              <div className={styles.timelineSection}>
                <button
                  type="button"
                  className={styles.timelineSectionHead}
                  aria-expanded={!folded}
                  data-testid="timeline-unscheduled"
                  onClick={() => setFolded((f) => !f)}
                >
                  <Chevron className={folded ? styles.timelineChevronShut : undefined} />
                  <span className={styles.timelineSectionName}>Not scheduled</span>
                  <span className={styles.timelineSectionCount}>{unscheduled.length}</span>
                  <span className={styles.timelineSectionSaid}>
                    No end date yet, so they have no place on the days.
                  </span>
                </button>
              </div>
              {!folded &&
                unscheduled.map((task) => (
                  <div
                    key={task.id}
                    className={styles.roadmapRow}
                    data-testid="timeline-row"
                    data-unscheduled=""
                    data-open={selectedTaskId === task.id || undefined}
                  >
                    {name(task)}
                    {empty(task)}
                  </div>
                ))}
            </>
          )}

          <div className={styles.timelineAddRow}>
            {composing ? (
              <div className={styles.timelineCompose}>
                <Composer
                  ref={inputRef}
                  note={addNote}
                  commit={(title) => void commit(title)}
                  cancel={() => setComposing(false)}
                />
              </div>
            ) : (
              <div className={styles.timelineAddStrip}>
                <button
                  type="button"
                  className={styles.roadmapAddButton}
                  data-testid="timeline-add"
                  onClick={() => setComposing(true)}
                >
                  <span aria-hidden className={styles.roadmapAddPlus}>
                    +
                  </span>
                  New task
                </button>
              </div>
            )}
          </div>

          {/* The names column runs on below the last row, beside the lines. */}
          <div className={styles.roadmapRest} aria-hidden>
            <div className={styles.roadmapName} />
          </div>
        </div>
      </div>
    </div>
  );
}
