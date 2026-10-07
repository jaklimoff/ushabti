"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatDate, type BoardColumn } from "@/lib/board";
import type { DoneWhen } from "@/lib/links";
import { progressOf } from "@/lib/progress";
import {
  SHIP_REST_LABEL,
  shipQuestion,
  shipRestsFor,
  shipWord,
  splitShip,
  type ShipRest,
} from "@/lib/ship";
import type { PropertyOptionDTO, TaskDTO } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmRow";
import { MentionList, useMentions } from "./Mentions";
import { TaskCard } from "./TaskCard";
import styles from "./board.module.css";

export const COLUMN_PREFIX = "column:";
export const CONTAINER_PREFIX = "container:";

function SortableTask({
  task,
  columnId,
  selected,
  cursor,
  onOpen,
  onPick,
}: {
  task: TaskDTO;
  columnId: string;
  selected: boolean;
  cursor: boolean;
  onOpen: () => void;
  onPick: (event: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "card", columnId },
    transition: { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });

  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      selected={selected}
      cursor={cursor}
      ghost={isDragging}
      onOpen={onOpen}
      onPick={onPick}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined,
      }}
      dragProps={{ ...attributes, ...listeners }}
    />
  );
}

export type ComposerPlace = "top" | "bottom";

/**
 * Nobody moves.
 *
 * A sorted column draws an order no drop can write, so the cards under a
 * lifted one must not open a gap: the gap would promise a place the card
 * cannot keep, and the card snapping back reads as the drag having failed.
 * The card is still carried, because another column is still somewhere to go.
 */
const HELD: SortingStrategy = () => null;

/** How this project measures a column: its done rule and its unit. */
export type ProgressRule = {
  doneWhen: DoneWhen | null;
  /** The number property the bar sums, or null to count tasks. */
  countBy: { id: string; name: string } | null;
};

/** The dates of the option a column stands for, when it has one to show. */
export type ColumnDates = Pick<PropertyOptionDTO, "targetAt" | "shippedAt">;

/**
 * What the header of a dated column says: the day, and how far it has come.
 *
 * A shipped date takes the target's place, because once it shipped the plan
 * is history. The progress reads the cards in the column, which are the cards
 * the view's filters left, so the bar agrees with what is on the screen.
 */
function releaseOf(dates: ColumnDates | null, tasks: TaskDTO[], rule: ProgressRule) {
  const day = dates?.shippedAt ?? dates?.targetAt;
  if (!dates || !day) return null;
  const { done, total } = progressOf(tasks, rule.doneWhen, rule.countBy?.id ?? null);
  return {
    shipped: !!dates.shippedAt,
    day,
    done,
    total,
    share: total > 0 ? Math.min(1, Math.max(0, done / total)) : 0,
    said: `${done} of ${total} ${rule.countBy ? rule.countBy.name : total === 1 ? "task" : "tasks"} done`,
  };
}

/**
 * How this column may ship, or null when it may not: it stands for no dated
 * option, it already shipped, the person is not an admin, or a filter hides
 * part of it — under a rule the numbers in the question would not be the
 * numbers that go, exactly as a sweep.
 */
export type ShipOffer = {
  /** The option after this one, or null when it is the last. */
  nextName: string | null;
  /** A sprint closes and archives nothing; a release ships. */
  closing: boolean;
  /** Settles once the ship is answered and the board read again. */
  onShip: (rest: ShipRest) => Promise<boolean>;
};

export function Column({
  column,
  selectedTaskId,
  cursorTaskId,
  draggable,
  frozen,
  addNote,
  composing,
  onCompose,
  onOpenTask,
  onPickTask,
  onAddTask,
  onArchiveAll,
  onFold,
  dates,
  ended,
  rule,
  ship,
}: {
  column: BoardColumn;
  selectedTaskId: string | null;
  cursorTaskId: string | null;
  draggable: boolean;
  /** The board is in a sort, so the cards in this column hold still. */
  frozen: boolean;
  /** What the filter will put on the new task, or "" when it puts nothing. */
  addNote: string;
  /** Where the composer is open in this column, if it is. The board holds it,
      so that a key pressed on the board can open it too. */
  composing: ComposerPlace | null;
  onCompose: (place: ComposerPlace | null) => void;
  onOpenTask: (task: TaskDTO) => void;
  /** Picks one card of this column, or puts it back. Shift asks for the run. */
  onPickTask: (taskId: string, event: React.MouseEvent) => void;
  /** Adds a task here, or null when a task added here would fail the filter:
      the column is drawn for the cards in it and offers no composer. */
  onAddTask: ((column: BoardColumn, title: string, atTop: boolean) => void) | null;
  /**
   * Archives every task in this column, or null when the column cannot be
   * swept: with no grouping property there is no column to name, and under a
   * filter the cards on screen are not the whole column, so the question and
   * the act would be two different things.
   */
  onArchiveAll: (() => void) | null;
  /** Folds this column to a strip, or opens it again. This browser only. */
  onFold: (folded: boolean) => void;
  /** The dates of the option this column stands for, or null for none. */
  dates: ColumnDates | null;
  /** "Ended 2 days ago" for an open sprint past its end, which waits for Close. */
  ended: string | null;
  rule: ProgressRule;
  ship: ShipOffer | null;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sweep = useConfirm();
  const shipAsk = useConfirm();
  /* A ship is one press: while it is out, the button stays away. */
  const [shipping, setShipping] = useState(false);
  const canShip = !!ship && !!dates?.targetAt && !dates.shippedAt && !shipping;
  const release = releaseOf(dates, column.tasks, rule);
  /* The day and the sum. An ended header sets them on a line of their own:
     "Ended 12 days ago" is longer than the name, and on one line it left the
     name no room at all in a column this wide. */
  const when = release && (
    <>
      <span
        className={`${styles.colDate} ${release.shipped ? styles.colShipped : ""} ${ended ? styles.colEnded : ""}`}
        data-testid="column-date"
        title={`${release.shipped ? "Shipped" : "Target"} ${release.day}`}
      >
        {release.shipped && "✓ "}
        {ended ?? formatDate(release.day)}
      </span>
      {rule.countBy && (
        <span className={styles.colSum} data-testid="column-sum" title={release.said}>
          {release.done} of {release.total}
        </span>
      )}
    </>
  );

  const sortable = useSortable({
    id: COLUMN_PREFIX + column.id,
    data: { type: "column", columnId: column.id },
    disabled: !draggable,
  });

  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: CONTAINER_PREFIX + column.id,
    data: { type: "container", columnId: column.id },
  });

  useEffect(() => {
    if (composing) inputRef.current?.focus();
  }, [composing]);

  function commit() {
    const title = draft.trim();
    if (title) onAddTask?.(column, title, composing === "top");
    setDraft("");
    onCompose(null);
  }

  const className = [
    styles.column,
    column.folded ? styles.columnFolded : "",
    column.isNone ? styles.columnNone : "",
    isOver ? styles.columnOver : "",
    sortable.isDragging ? styles.columnDragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  const place = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition ?? undefined,
  };

  /*
   * The strip is the header stood on its end, and the whole of it is the
   * button that opens the column again. It carries the drop target, so a card
   * dragged onto it still lands at the end of the column and nothing is lost.
   *
   * There is no grip here on purpose. A grip inside a button is two answers to
   * one press, and the column order belongs to the option everybody shares
   * while a fold belongs to this browser. Open the column to move it.
   */
  if (column.folded) {
    return (
      <div ref={sortable.setNodeRef} className={className} data-testid="column" style={place}>
        <button
          ref={setDropRef}
          className={styles.strip}
          data-testid="column-strip"
          title="Open this column"
          aria-label={`Open the column ${column.name}`}
          onClick={() => onFold(false)}
        >
          <span
            className={styles.colDot}
            style={{ background: column.color, boxShadow: `0 0 0 3px ${column.color}18` }}
          />
          <span className={styles.colCount} data-testid="column-count">
            {column.tasks.length}
          </span>
          <span className={styles.stripName} data-testid="column-name">
            {column.name}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div ref={sortable.setNodeRef} className={className} data-testid="column" style={place}>
      {/* The board has no dialogs, so the header itself becomes the question
          and names in real numbers what it is about to do. The cards stay on
          screen behind it: they are what the number counts. */}
      {shipAsk.asking && ship ? (
        <ShipQuestion
          column={column}
          rule={rule}
          ship={ship}
          onCancel={shipAsk.cancel}
          onPick={(rest) =>
            shipAsk.confirm(() => {
              setShipping(true);
              /* The board is read again before the answer comes, so a ship
                 that went through already hides the button by its date. Let
                 go either way, or an Unship would find it still held. */
              void ship.onShip(rest).finally(() => setShipping(false));
            })
          }
        />
      ) : sweep.asking ? (
        <div
          className={`${styles.colHead} ${styles.colHeadAsking}`}
          role="alertdialog"
          aria-label={`Archive everything in ${column.name}`}
        >
          <span className={styles.colConfirm} data-testid="column-confirm">
            Archive {column.tasks.length} {column.tasks.length === 1 ? "task" : "tasks"} in{" "}
            {column.name}?{" "}
            {column.tasks.length === 1
              ? "It leaves the board and keeps its history."
              : "They leave the board and keep their history."}
          </span>
          <button
            className={styles.colConfirmYes}
            autoFocus
            onClick={() => sweep.confirm(() => onArchiveAll?.())}
          >
            Yes, archive
          </button>
          <button className={styles.colConfirmNo} onClick={sweep.cancel}>
            Cancel
          </button>
        </div>
      ) : (
        <div className={`${styles.colHead} ${ended ? styles.colHeadEnded : ""}`}>
          {draggable ? (
            <span
              className={styles.grip}
              title="Drag to reorder the column"
              {...sortable.attributes}
              {...sortable.listeners}
              aria-label={`Reorder the column ${column.name}`}
            >
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
          ) : (
            <span style={{ width: 10 }} />
          )}
          <span className={styles.colTitle}>
            <span
              className={styles.colDot}
              style={{ background: column.color, boxShadow: `0 0 0 3px ${column.color}18` }}
            />
            <span className={styles.colName} data-testid="column-name">
              {column.name}
            </span>
          </span>
          <span className={styles.colCount} data-testid="column-count">
            {column.tasks.length}
          </span>
          {ended ? <span className={styles.colMeta}>{when}</span> : when}
          <span className={styles.colSpacer} style={{ flex: 1 }} />
          {onAddTask && (
            <button
              className={styles.colAdd}
              aria-label={`Add a task to the top of ${column.name}`}
              title="Add a task to the top of this column"
              onClick={() => {
                onCompose("top");
                setDraft("");
              }}
            >
              +
            </button>
          )}
          {/* Archive is how a column that has done its job is emptied. It is
            offered only when the whole column is on screen. */}
          {onArchiveAll && column.tasks.length > 0 && (
            <button
              className={`${styles.colAdd} ${styles.colArchive}`}
              data-testid="column-archive"
              aria-label={`Archive everything in ${column.name}`}
              title="Archive everything in this column"
              onClick={sweep.ask}
            >
              ↓
            </button>
          )}
          {canShip && (
            <button
              className={`${styles.colAdd} ${styles.colShip}`}
              data-testid="column-ship"
              aria-label={`${shipWord(ship.closing)} ${column.name}`}
              title={
                ship.closing
                  ? "Close: end this sprint and keep its tasks on the board"
                  : "Ship: archive what is over and close this option"
              }
              onClick={shipAsk.ask}
            >
              ✓
            </button>
          )}
          <button
            className={`${styles.colAdd} ${styles.colFold}`}
            aria-label={`Fold the column ${column.name}`}
            title="Fold this column to a strip"
            onClick={() => onFold(true)}
          >
            «
          </button>
        </div>
      )}

      {release && (
        <div
          className={styles.colProgress}
          role="progressbar"
          data-testid="column-progress"
          aria-label={release.said}
          aria-valuemin={0}
          aria-valuemax={release.total}
          aria-valuenow={release.done}
          title={release.said}
        >
          <span style={{ width: `${release.share * 100}%`, background: column.color }} />
        </div>
      )}

      <div className={styles.colBody} ref={setDropRef} data-testid="column-body">
        {onAddTask && composing === "top" && (
          <Composer
            ref={inputRef}
            draft={draft}
            setDraft={setDraft}
            note={addNote}
            commit={commit}
            cancel={() => onCompose(null)}
          />
        )}

        <SortableContext
          items={column.tasks.map((t) => t.id)}
          strategy={frozen ? HELD : verticalListSortingStrategy}
        >
          {column.tasks.map((task) => (
            <SortableTask
              key={task.id}
              task={task}
              columnId={column.id}
              selected={selectedTaskId === task.id}
              cursor={cursorTaskId === task.id}
              onOpen={() => onOpenTask(task)}
              onPick={(event) => onPickTask(task.id, event)}
            />
          ))}
        </SortableContext>

        {onAddTask && composing === "bottom" && (
          <Composer
            ref={inputRef}
            draft={draft}
            setDraft={setDraft}
            note={addNote}
            commit={commit}
            cancel={() => onCompose(null)}
          />
        )}

        {onAddTask && composing === null && (
          <button
            className={styles.emptyDrop}
            onClick={() => {
              onCompose("bottom");
              setDraft("");
            }}
            title="Add a task"
            aria-label={`Add a task to ${column.name}`}
          >
            {column.tasks.length === 0 ? "Add a task" : ""}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The header become the question a ship asks. It names both numbers from the
 * cards on screen, which are the whole column, and each answer about the rest
 * is its own button, so one press both answers and confirms.
 */
function ShipQuestion({
  column,
  rule,
  ship,
  onPick,
  onCancel,
}: {
  column: BoardColumn;
  rule: ProgressRule;
  ship: ShipOffer;
  onPick: (rest: ShipRest) => void;
  onCancel: () => void;
}) {
  const { over, rest } = splitShip(column.tasks, rule.doneWhen);
  /* With nothing left over there is nothing to decide about it. */
  const answers: ShipRest[] = rest.length ? shipRestsFor(ship.nextName !== null) : ["leave"];
  return (
    <div
      className={`${styles.colHead} ${styles.colHeadAsking}`}
      role="alertdialog"
      aria-label={`${shipWord(ship.closing)} ${column.name}`}
    >
      <span className={styles.colConfirm} data-testid="ship-confirm">
        {shipQuestion(column.name, over.length, rest.length, ship.closing)}
        {rest.length > 0 && " What happens to them?"}
      </span>
      {answers.map((answer, i) => (
        <button
          key={answer}
          className={`${styles.colConfirmYes} ${styles.colShipAnswer}`}
          autoFocus={i === 0}
          title={answer === "next" ? `Move them to ${ship.nextName}` : undefined}
          onClick={() => onPick(answer)}
        >
          {rest.length ? SHIP_REST_LABEL[answer] : `Yes, ${shipWord(ship.closing).toLowerCase()}`}
        </button>
      ))}
      <button className={styles.colConfirmNo} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** The box a new task is typed into. A column draws it at its top and bottom,
    and a list at its end, so the two read and grow the same way. */
export const Composer = function Composer({
  ref,
  draft,
  setDraft,
  note,
  commit,
  cancel,
}: {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  note: string;
  commit: () => void;
  cancel: () => void;
}) {
  const picker = useMentions(ref, setDraft);

  /* The box grows with the title, so a long one is read before Enter makes
     the task. Before paint, so the box never shows a scrollbar for a frame.
     `field-sizing: content` would do this in CSS, but not in every browser. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, draft]);

  return (
    <div className={styles.composer}>
      <textarea
        ref={ref}
        className={styles.composerInput}
        value={draft}
        placeholder="What needs doing?"
        onChange={(e) => {
          setDraft(e.target.value);
          picker.sync();
        }}
        onSelect={picker.sync}
        onKeyDown={(e) => {
          /* The list has the keys while it is open, so Enter picks a name
             instead of making the task. */
          if (picker.onKeyDown(e)) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => {
          picker.close();
          if (draft.trim()) commit();
          else cancel();
        }}
      />
      {/* A filtered board says what it is about to write, so the card it
          makes is never a surprise and never disappears. */}
      <span className={styles.composerHint}>Enter to add · {note || "Esc to cancel"}</span>
      <MentionList picker={picker} />
    </div>
  );
};
