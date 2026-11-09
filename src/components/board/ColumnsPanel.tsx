"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { buildRow, type CardItem, sampleTask, setCardMode, viewOf } from "@/lib/card-view";
import { isColumn, listLookOf, listLooks, showColumn } from "@/lib/list-view";
import type { CardMode, TaskDTO } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/Button";
import { Chevron } from "@/components/ui/Marks";
import { useDismiss } from "@/components/ui/useDismiss";
import { Chip } from "./Chip";
import { isTyping } from "./keys";
import { useBoard } from "./store";
import boardStyles from "./board.module.css";
import styles from "./panel.module.css";

/** The parts a task has of its own that a list can draw, always last. */
const FROM_THE_TASK = ["_checklist", "_parts", "_comments", "_created", "_updated"];

/** The two ways the title reads: alone, or with the description after it. */
const TITLE_LOOKS = [
  { id: "alone", label: "Title only" },
  { id: "desc", label: "With description" },
] as const;

type Look = { id: string; label: string; chips: React.ReactNode };

/**
 * The columns of a list, beside the list they arrange. It sits where the Card
 * drawer sits on a board, because it answers the same question for a row:
 * what it carries and how each part reads. It writes the view's card through
 * the same store call, so the list and its card stay one object. A list has
 * no board card to show, so a row of it stands at the top instead.
 *
 * What shows and how it reads is the view's, for everyone on it. The widths
 * are the person's, so they sit apart, at the foot.
 */
export function ColumnsPanel({
  onClose,
  onLit,
}: {
  onClose: () => void;
  /** Names the column being changed, so the list can light its heading. */
  onLit: (id: string | null) => void;
}) {
  const { data, view, keys, cardItemsOf, setCardView, lensWidths, setWidths, moveProperty } =
    useBoard();
  const panelRef = useRef<HTMLElement>(null);
  /* The row under the pointer or the keys, the row whose looks are open, and
     the look the pointer rests on. The sample answers all three. */
  const [near, setNear] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);

  const viewId = view?.id ?? null;
  const items = useMemo(() => (viewId ? cardItemsOf(viewId) : []), [cardItemsOf, viewId]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const properties = items.filter((i) => i.property);
  const fromTask = FROM_THE_TASK.map((id) => byId.get(id)).filter((i): i is CardItem => !!i);

  const task = useMemo<TaskDTO>(
    () => ({
      ...sampleTask(data.properties, data.members, data.project.key),
      title: "A row of this project, drawn the way the columns say",
    }),
    [data.properties, data.members, data.project.key],
  );

  const touched = open ?? near;
  useEffect(() => {
    onLit(touched);
  }, [onLit, touched]);
  useEffect(() => () => onLit(null), [onLit]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      /* An open look menu closes on Escape first, and has answered the key. */
      if (event.key === "Escape" && !event.defaultPrevented && !isTyping(event.target)) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const closeMenu = useCallback(() => {
    setOpen(null);
    setPeek(null);
  }, []);

  if (!view || view.kind !== "list") return null;

  /* A click says what the whole card becomes. A list always writes its own
     copy: it never asks whether to change the default, because a list does
     not draw a card, and nobody arranging columns is thinking of one. */
  const write = (next: ReturnType<typeof viewOf>) => void setCardView(next, view.id);
  const current = viewOf(items);

  const key = byId.get("_key");
  const title = byId.get("_title");
  const desc = byId.get("_desc");
  const descOn = desc ? isColumn(desc) : false;
  const total = 2 + properties.length + fromTask.length;
  const shown = 2 + [...properties, ...fromTask].filter(isColumn).length;
  const mayOrder = data.project.mayStructure;

  /** The chips one look of one row draws on the sample task. */
  const chipsOf = (item: CardItem, mode: CardMode) => {
    const cells = buildRow(
      [{ ...item, place: "body", mode }],
      task,
      data.members,
      data.former,
      data.project.timeZone,
      keys,
    ).cells;
    return (cells[item.id] ?? []).map((chip) => <Chip key={chip.key} chip={chip} />);
  };

  const looksOf = (item: CardItem): Look[] =>
    listLooks(item.kind).map((look) => ({
      id: look.id,
      label: look.label,
      chips: chipsOf(item, look.id),
    }));

  /* The column the sample shows: the one being touched, or else the first
     property on the list, so the sample is never a row of nothing. */
  const litId =
    touched && touched !== "_key" && touched !== "_title"
      ? touched
      : (properties.find(isColumn)?.id ?? null);
  const lit = litId ? byId.get(litId) : undefined;
  /* A look under the pointer is drawn before it is picked, and a hidden
     column under the pointer is drawn where it would land. */
  const draft = lit && ((peek !== null && open === lit.id) || !isColumn(lit));
  const litMode: CardMode | null =
    lit && open === lit.id && peek ? (peek as CardMode) : lit ? listLookOf(lit) : null;
  const titlePeek = open === "_title" && peek ? peek === "desc" : descOn;

  let note: React.ReactNode = null;
  if (open === "_title" && peek) {
    note = (
      <>
        <b>{peek === "desc" ? "With description" : "Title only"}</b>, not saved yet. Pick it to
        change {view.name} for everyone.
      </>
    );
  } else if (lit && draft && open === lit.id && peek) {
    const word = listLooks(lit.kind).find((l) => l.id === peek)?.label ?? peek;
    note = (
      <>
        <b>{word}</b>, not saved yet. Pick it to change {view.name} for everyone.
      </>
    );
  } else if (lit && !isColumn(lit) && touched === lit.id) {
    const order = items.filter((i) => i.id !== "_desc");
    const before = order
      .slice(0, order.indexOf(lit))
      .reverse()
      .find((i) => i.id === "_key" || i.id === "_title" || isColumn(i));
    note = (
      <>
        <b>{lit.name}</b> is hidden. Tick it to show it after {before?.name ?? "Title"}.
      </>
    );
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    void moveProperty(String(active.id), String(over.id));
  }

  const sized = Object.keys(lensWidths).length;

  const rowProps = (item: CardItem) => ({
    item,
    open: open === item.id,
    looks: looksOf(item),
    look: listLookOf(item),
    onNear: (on: boolean) => setNear((was) => (on ? item.id : was === item.id ? null : was)),
    onToggle: (on: boolean) => {
      closeMenu();
      write(showColumn(current, item, on));
    },
    onOpen: () => {
      setPeek(null);
      setOpen((was) => (was === item.id ? null : item.id));
    },
    onClose: closeMenu,
    onPeek: setPeek,
    onPick: (mode: string) => {
      closeMenu();
      write(setCardMode(current, item.id, mode as CardMode));
    },
  });

  return (
    <aside
      className={`${styles.panel} ${styles.cardPanel} ${styles.columnsPanel}`}
      data-testid="columns-panel"
      data-drawer-panel
      ref={panelRef}
      tabIndex={-1}
      aria-label="Columns"
    >
      <div className={styles.head}>
        <div className={styles.headRow}>
          <h2 className={styles.optionName}>Columns</h2>
          <span className={styles.columnsCount} data-testid="columns-count">
            {shown} of {total} shown
          </span>
          <span style={{ flex: 1 }} />
          <IconButton size={28} label="Close the columns" title="Close (Esc)" onClick={onClose}>
            ✕
          </IconButton>
        </div>
        <div className={styles.cardPanelSub}>
          How a row reads on {view.name}, for everyone on it
        </div>
      </div>

      {/* The sample stays put while the rows scroll, so a project with twenty
          properties still shows what the row it is changing looks like. */}
      <section className={styles.columnsSample} aria-label={`A row of ${view.name}`}>
        <div className={styles.columnsSampleBox} aria-hidden data-testid="columns-sample">
          <div className={`${styles.columnsSampleGrid} ${styles.columnsSampleHead}`}>
            <span>{key?.name}</span>
            <span>{title?.name}</span>
            <span className={styles.columnsSampleLit}>{lit?.name}</span>
          </div>
          <div className={styles.columnsSampleGrid}>
            <span className={styles.columnsSampleKey}>{task.key}</span>
            <span className={styles.columnsSampleTitle}>
              <span className={styles.columnsSampleWords}>{task.title}</span>
              {titlePeek && <span className={boardStyles.listDesc}>{task.description}</span>}
            </span>
            <span
              className={styles.columnsSampleCell}
              data-draft={draft ? "true" : undefined}
              data-testid="columns-sample-cell"
            >
              {lit && litMode ? chipsOf(lit, litMode) : null}
            </span>
          </div>
        </div>
        <div className={styles.columnsSampleNote} aria-live="polite" data-testid="columns-note">
          {note}
        </div>
      </section>

      <div className={styles.body}>
        <div className={styles.columnsBody}>
          {key && (
            <FixedRow
              item={key}
              onNear={(on) => setNear((was) => (on ? key.id : was === key.id ? null : was))}
            >
              <span className={styles.columnsFixed} id="columns-always">
                Always shown
              </span>
            </FixedRow>
          )}
          {title && (
            <FixedRow
              item={title}
              onNear={(on) => setNear((was) => (on ? title.id : was === title.id ? null : was))}
            >
              {desc && (
                <LookButton
                  name={title.name}
                  looks={TITLE_LOOKS.map((l) => ({ ...l, chips: null }))}
                  current={descOn ? "desc" : "alone"}
                  open={open === "_title"}
                  onOpen={() => {
                    setPeek(null);
                    setOpen((was) => (was === "_title" ? null : "_title"));
                  }}
                  onClose={closeMenu}
                  onPeek={setPeek}
                  onPick={(id) => {
                    closeMenu();
                    write(showColumn(current, desc, id === "desc"));
                  }}
                />
              )}
            </FixedRow>
          )}

          {properties.length > 0 && (
            <div className={styles.columnsGroup}>
              <span className={styles.columnsGroupName}>Properties</span>
              <span className={styles.columnsGroupNote} id="columns-move-help">
                {mayOrder ? "A move here moves it on every view" : "The order is set in Settings"}
              </span>
            </div>
          )}
          <DndContext
            id="ushabti-columns"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={closeMenu}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={properties.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {properties.map((item) => (
                <ColumnRow key={item.id} {...rowProps(item)} movable={mayOrder} />
              ))}
            </SortableContext>
          </DndContext>

          {fromTask.length > 0 && (
            <div className={styles.columnsGroup}>
              <span className={styles.columnsGroupName}>From the task</span>
              <span className={styles.columnsGroupNote}>Always last, in this order</span>
            </div>
          )}
          {fromTask.map((item) => (
            <ColumnRow key={item.id} {...rowProps(item)} movable={false} />
          ))}
        </div>
      </div>

      <div className={styles.columnsFoot}>
        <div className={styles.columnsFootWords}>
          <span className={styles.columnsFootTitle}>Widths are yours</span>
          <span className={styles.columnsFootNote} data-testid="columns-widths">
            {sized === 0
              ? "Drag the edge of a heading to size a column."
              : "Your widths are kept for this list. Nobody else sees them."}
          </span>
        </div>
        <Button variant="ghost" disabled={sized === 0} onClick={() => void setWidths({})}>
          Reset my widths
        </Button>
      </div>
    </aside>
  );
}

/** The key and the title: always on the list, never moved. */
function FixedRow({
  item,
  onNear,
  children,
}: {
  item: CardItem;
  onNear: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={styles.columnsRow}
      data-testid="columns-row"
      data-column={item.id}
      onPointerEnter={() => onNear(true)}
      onPointerLeave={() => onNear(false)}
    >
      <span className={styles.columnsLock} aria-hidden>
        <LockMark />
      </span>
      <label className={`${styles.columnsPick} ${styles.columnsPickFixed}`}>
        <input
          type="checkbox"
          className={styles.columnsCheck}
          checked
          disabled
          aria-describedby="columns-always"
        />
        <span className={styles.columnsName}>{item.name}</span>
      </label>
      {children}
    </div>
  );
}

function ColumnRow({
  item,
  movable,
  open,
  looks,
  look,
  onNear,
  onToggle,
  onOpen,
  onClose,
  onPeek,
  onPick,
}: {
  item: CardItem;
  movable: boolean;
  open: boolean;
  looks: Look[];
  look: string;
  onNear: (on: boolean) => void;
  onToggle: (on: boolean) => void;
  onOpen: () => void;
  onClose: () => void;
  onPeek: (id: string | null) => void;
  onPick: (id: string) => void;
}) {
  const sortable = useSortable({
    id: item.id,
    disabled: !movable,
    transition: { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });
  const on = isColumn(item);
  const [hover, setHover] = useState(false);

  return (
    <div
      ref={sortable.setNodeRef}
      className={styles.columnsRow}
      data-testid="columns-row"
      data-column={item.id}
      data-off={on ? undefined : "true"}
      data-open={open ? "true" : undefined}
      data-dragging={sortable.isDragging ? "true" : undefined}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition ?? undefined,
      }}
      onPointerEnter={() => {
        setHover(true);
        onNear(true);
      }}
      onPointerLeave={() => {
        setHover(false);
        onNear(false);
      }}
      onFocus={() => onNear(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onNear(false);
      }}
    >
      {movable ? (
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          className={styles.columnsGrip}
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Move ${item.name}`}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} />
          ))}
        </button>
      ) : (
        <span className={styles.columnsLock} aria-hidden />
      )}
      <label className={styles.columnsPick} title={item.name}>
        <input
          type="checkbox"
          className={styles.columnsCheck}
          checked={on}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span className={styles.columnsName}>{item.name}</span>
      </label>
      {!on ? (
        hover && <span className={styles.columnsFixed}>Tick to show</span>
      ) : looks.length === 1 ? (
        <span className={styles.columnsFixed} title={`The one way ${item.name} reads`}>
          {looks[0].label}
        </span>
      ) : (
        <LookButton
          name={item.name}
          looks={looks}
          current={look}
          open={open}
          onOpen={onOpen}
          onClose={onClose}
          onPeek={onPeek}
          onPick={onPick}
        />
      )}
    </div>
  );
}

/**
 * How a column reads, as one word that opens the choices under it. Each
 * choice carries the chip it draws, so nobody has to learn what "Filled"
 * means before picking it.
 */
function LookButton({
  name,
  looks,
  current,
  open,
  onOpen,
  onClose,
  onPeek,
  onPick,
}: {
  name: string;
  looks: Look[];
  current: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPeek: (id: string | null) => void;
  onPick: (id: string) => void;
}) {
  const ref = useDismiss<HTMLDivElement>(onClose, open);
  const menuRef = useRef<HTMLDivElement>(null);
  const word = looks.find((l) => l.id === current)?.label ?? looks[0]?.label;

  /* The focus goes to the picked look, so the arrows start from there. */
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const all = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = all[(at + (event.key === "ArrowDown" ? 1 : all.length - 1)) % all.length];
      next?.focus();
    }
  }

  return (
    <div className={styles.columnsLookWrap} ref={ref}>
      <button
        type="button"
        className={styles.columnsLook}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${name} reads as ${word}`}
        data-testid="columns-look"
        onClick={onOpen}
      >
        {word}
        <Chevron size={9} className={open ? styles.columnsLookUp : undefined} />
      </button>
      {open && (
        <div
          className={styles.columnsMenu}
          role="menu"
          aria-label={`How ${name} reads`}
          ref={menuRef}
          onKeyDown={onKeyDown}
          onPointerLeave={() => onPeek(null)}
        >
          {looks.map((look) => (
            <button
              key={look.id}
              type="button"
              role="menuitemradio"
              aria-checked={look.id === current}
              className={styles.columnsMenuItem}
              data-testid="columns-look-option"
              onPointerEnter={() => onPeek(look.id)}
              onFocus={() => onPeek(look.id)}
              onClick={() => onPick(look.id)}
            >
              <span className={styles.columnsMenuTick} aria-hidden>
                {look.id === current ? "✓" : ""}
              </span>
              <span className={styles.columnsMenuWord}>{look.label}</span>
              {look.chips && <span className={styles.columnsMenuChip}>{look.chips}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LockMark() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
    </svg>
  );
}
