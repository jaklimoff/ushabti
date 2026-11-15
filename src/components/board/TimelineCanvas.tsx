"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Chevron } from "@/components/ui/Marks";
import { formatDate, sortByPosition } from "@/lib/board";
import { cardFace, cardStripe } from "@/lib/card-view";
import { seedNote, seedValues } from "@/lib/filters";
import { startsWith } from "@/lib/when";
import { isOver } from "@/lib/links";
import { personName, personOf } from "@/lib/people";
import { sortTasks } from "@/lib/sort";
import { lateWords, NO_DATES, spanOf, timelineRows, type TimelineRow } from "@/lib/timeline";
import type { TaskDTO } from "@/lib/types";
import { Composer } from "./Column";
import { Days, daysStyle, MONO_CH, useDays } from "./Days";
import { TimelineDatesChips } from "./TimelineDates";
import { useBoard } from "./store";
import styles from "./board.module.css";

/* A task whose card wears no stripe: the neutral grey of a built-in row. */
const NEUTRAL = "#8b8f98";

/**
 * The timeline.
 *
 * One row per task the view shows, in the order a list would draw them, and a
 * bar from the day it starts to the day it ends on the roadmap's line of
 * weeks. Which rows there are and where each bar stands is `timelineRows`';
 * this draws its answer and decides nothing. A bar, a diamond, a chip and a
 * row's name open the task, as a card does. Nothing here writes a date.
 */
export function TimelineCanvas({
  selectedTaskId,
  onOpenTask,
}: {
  selectedTaskId: string | null;
  onOpenTask: (task: TaskDTO | null) => void;
}) {
  const { data, view, visibleTasks, filters, cardItems, sort, createTask, updateView, user } =
    useBoard();
  const [folded, setFolded] = useState(false);
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  function row(r: TimelineRow<TaskDTO>) {
    const task = r.task;
    const color = cardStripe(cardItems, task, data.members, data.former)?.color ?? NEUTRAL;
    const person = face?.property
      ? personOf(task.values[face.property.id], data.members, data.former)
      : null;
    const left = at(r.start);
    const width = at(r.end) - left + day;
    const spoken = `${task.key} ${task.title}`;

    /* What is said after the bar: the face, then the end day and its state. */
    const said = formatDate(r.end);
    const state = r.over ? "done" : r.late ? lateWords(r.late) : "";
    const words = state ? `${said} · ${state}` : said;
    const wordsWidth = words.length * MONO_CH + (person ? 22 : 0);

    let shape: React.ReactNode;
    let after = left + width + 6;
    let start = left;
    if (r.shape === "bar") {
      const share = r.over ? 1 : r.checklist ? r.checklist.done / r.checklist.total : 0;
      shape = (
        <button
          type="button"
          className={`${styles.roadmapBar} ${styles.timelineBar}`}
          data-testid="timeline-bar"
          data-over={r.over || undefined}
          style={{ left, width, "--c": color } as CSSProperties}
          aria-label={`${spoken}: ${formatDate(r.start)} to ${said}${state ? `, ${state}` : ""}`}
          title={`${formatDate(r.start)} – ${said}`}
          onClick={() => onOpenTask(task)}
        >
          <span className={styles.roadmapFill} style={{ width: `${share * 100}%` }} />
          {r.checklist && !r.over && (
            <span className={styles.timelineCount}>
              {r.checklist.done}/{r.checklist.total}
            </span>
          )}
        </button>
      );
    } else if (r.shape === "point") {
      const x = left + day / 2;
      after = x + 12;
      start = x - 8;
      shape = (
        <button
          type="button"
          className={styles.timelineDiamond}
          data-testid="timeline-point"
          data-over={r.over || undefined}
          style={{ left: x, "--c": color } as CSSProperties}
          aria-label={`${spoken}: ${said}${state ? `, ${state}` : ""}`}
          title={said}
          onClick={() => onOpenTask(task)}
        />
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
            <span>{said}</span>
            {state && (
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
                    <div className={styles.roadmapTrack} />
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
