"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useBoard } from "@/components/board/store";
import { Chip } from "@/components/board/Chip";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Form";
import { Note } from "@/components/ui/Layout";
import { useDismiss } from "@/components/ui/useDismiss";
import {
  buildOne,
  canEdge,
  CHIP_PLACES,
  drawOrder,
  MODES_FOR_KIND,
  OFF_EDGE,
  sampleTask,
  type CardItem,
} from "@/lib/card-view";
import { CARD_PLACE_LABEL, type CardMode, type CardPlace, type TaskDTO } from "@/lib/types";
import { DROP_ZONES, zoneCollision, zoneToward, type DropZone } from "./card-drag";
import styles from "./settings.module.css";

type ChipPlace = (typeof CHIP_PLACES)[number];

const ZONE_LABEL: Record<ChipPlace, string> = {
  headerL: "Header · left",
  headerR: "Header · right",
  body: "Body",
  footerL: "Footer · left",
  footerR: "Footer · right",
};

/* An empty zone says what it is for, so a newcomer knows why they would. */
const ZONE_EMPTY: Record<ChipPlace, string> = {
  headerL: "Drop a chip here to open the top line",
  headerR: "Drop a chip here for the end of the top line",
  body: "Drop a chip here for a line under the title",
  footerL: "Drop a chip here to open the bottom line",
  footerR: "Drop a chip here for the end of the bottom line",
};

const ZONE_SAID: Record<DropZone, string> = {
  ...ZONE_LABEL,
  edge: "Edge",
  off: "Not on the card",
};

/**
 * The card editor's own view: one card drawn big, each row as its chip in the
 * place it sits, and a click or a drag to change it. Every change is one of
 * the card view's own calls, handed up as the place or the mode; nothing here
 * decides what a card carries.
 */
export function CardDrawing({
  items,
  open,
  onOpen,
  onNear,
  onPlace,
  onMode,
}: {
  items: CardItem[];
  open: string | null;
  onOpen: (id: string | null) => void;
  onNear: (id: string | null) => void;
  onPlace: (id: string, place: CardPlace) => void;
  onMode: (id: string, mode: CardMode) => void;
}) {
  const { data } = useBoard();
  /* A stand-in that holds a value for every property, so every chip has a
     real value to show, however empty the project's own tasks are. */
  const task = useMemo(
    () => sampleTask(data.properties, data.members, data.project.key),
    [data.members, data.project.key, data.properties],
  );
  const edgeHolder = items.find((i) => i.place === "edge") ?? null;
  const title = items.find((i) => i.place === "title") ?? null;
  const off = items.filter((i) => i.place === "off");

  const [lifted, setLifted] = useState<CardItem | null>(null);
  const closed = useCallback(
    (zone: DropZone) => zone === "edge" && !!lifted && !canEdge(lifted.kind),
    [lifted],
  );
  /* The zone a lifted chip is over while the keyboard moves it. The arrows
     walk the card as it is drawn, so they need to know where they are. */
  const keyAt = useRef<DropZone | null>(null);
  const closedNow = useRef(closed);
  closedNow.current = closed;
  /* Space drops the chip, and the button it lands on would read the same
     key's release as a click and open its popover. */
  const droppedAt = useRef(0);

  const coordinates = useCallback<KeyboardCoordinateGetter>((event, { context }) => {
    const from = keyAt.current;
    if (!from || !event.code.startsWith("Arrow")) return undefined;
    event.preventDefault();
    /* An arrow pressed right after the lift comes before dnd-kit has measured
       anything, so the zone's own box is read now. */
    const chip = context.collisionRect;
    const next = zoneToward(from, event.code, closedNow.current);
    const node = next && context.droppableContainers.get(next)?.node.current;
    if (!next || !node || !chip) return undefined;
    const rect = node.getBoundingClientRect();
    keyAt.current = next;
    return {
      x: rect.left + rect.width / 2 - chip.width / 2,
      y: rect.top + rect.height / 2 - chip.height / 2,
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: coordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const nameOf = (id: string | number) => items.find((i) => i.id === id)?.name ?? "The chip";
  const zoneOf = (id: string | number | undefined) =>
    id !== undefined && id in ZONE_SAID ? ZONE_SAID[id as DropZone].toLowerCase() : null;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Lifted ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${nameOf(active.id)} is over ${zoneOf(over.id)}.`
        : `${nameOf(active.id)} is over no place that takes it.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${nameOf(active.id)} dropped in ${zoneOf(over.id)}.`
        : `${nameOf(active.id)} stays where it was.`,
    onDragCancel: ({ active }) => `${nameOf(active.id)} stays where it was.`,
  };

  function start({ active }: DragStartEvent) {
    const item = items.find((i) => i.id === active.id) ?? null;
    setLifted(item);
    keyAt.current = item && item.place !== "title" ? (item.place as DropZone) : null;
    onOpen(null);
  }

  function end({ active, over }: DragEndEvent) {
    setLifted(null);
    keyAt.current = null;
    droppedAt.current = Date.now();
    const item = items.find((i) => i.id === active.id);
    if (!item || !over) return;
    const zone = over.id as DropZone;
    /* A closed zone takes no drop, whatever the pointer says. */
    if (!DROP_ZONES.includes(zone) || closed(zone) || zone === item.place) return;
    onPlace(item.id, zone);
  }

  const chipOf = (item: CardItem) => (
    <ChipButton
      key={item.id}
      item={item}
      items={items}
      task={task}
      edgeHolder={edgeHolder}
      open={open === item.id}
      droppedAt={droppedAt}
      onOpen={onOpen}
      onNear={onNear}
      onPlace={onPlace}
      onMode={onMode}
    />
  );

  const zone = (place: ChipPlace, wide = false) => {
    const here = drawOrder(items.filter((i) => i.place === place));
    return (
      <DropBox
        place={place}
        lifted={!!lifted}
        className={`${styles.zone} ${wide ? styles.zoneWide : ""}`}
      >
        <span className={styles.zoneLabel}>{ZONE_LABEL[place]}</span>
        {here.length ? (
          <span className={styles.zoneChips}>{here.map(chipOf)}</span>
        ) : (
          <span className={styles.zoneEmpty}>{ZONE_EMPTY[place]}</span>
        )}
      </DropBox>
    );
  };

  return (
    <DndContext
      id="ushabti-card-drawing"
      sensors={sensors}
      collisionDetection={zoneCollision}
      onDragStart={start}
      onDragEnd={end}
      onDragCancel={() => {
        setLifted(null);
        keyAt.current = null;
        droppedAt.current = Date.now();
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Press Space to lift the chip. The arrow keys move it to another place, Space drops it and Escape puts it back.",
        },
      }}
    >
      <div className={styles.drawing} data-testid="card-drawing">
        <div className={styles.bigCard}>
          <DropBox
            place="edge"
            lifted={!!lifted}
            closed={closed("edge")}
            className={styles.edgeRail}
          >
            <span className={styles.edgeRailLabel}>Edge</span>
            {edgeHolder && chipOf(edgeHolder)}
          </DropBox>
          <div className={styles.bigFace}>
            <div className={styles.zoneRow}>
              {zone("headerL")}
              {zone("headerR")}
            </div>
            <div
              className={styles.zoneTitle}
              data-testid="card-zone-title"
              data-closed={lifted ? "" : undefined}
            >
              <span className={styles.zoneLabel}>Title · always here</span>
              <span className={styles.bigTitle} title={title?.name ?? "Title"}>
                {task.title}
              </span>
            </div>
            {zone("body", true)}
            <div className={styles.zoneRow}>
              {zone("footerL")}
              {zone("footerR")}
            </div>
          </div>
        </div>

        <DropBox place="off" lifted={!!lifted} className={styles.offCard}>
          <span className={styles.zoneLabel}>Not on the card</span>
          {off.length ? (
            <span className={styles.zoneChips}>{off.map(chipOf)}</span>
          ) : (
            <span className={styles.zoneEmpty}>Everything is on the card.</span>
          )}
        </DropBox>

        <Note>Drag a chip to another place, or off the card.</Note>
      </div>
    </DndContext>
  );
}

/**
 * A zone a chip can land in. While a chip is lifted every zone says whether it
 * takes it: a closed one is greyed and is no target at all.
 */
function DropBox({
  place,
  lifted,
  closed = false,
  className,
  children,
}: {
  place: DropZone;
  lifted: boolean;
  closed?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: place, disabled: closed });
  const testId = place === "off" ? "card-off" : `card-zone-${place}`;
  return (
    <div
      ref={setNodeRef}
      className={className}
      data-testid={testId}
      data-open={lifted && !closed ? "" : undefined}
      data-closed={lifted && closed ? "" : undefined}
      data-over={isOver ? "" : undefined}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One chip, and the popover it opens                                  */
/* ------------------------------------------------------------------ */

function ChipButton({
  item,
  items,
  task,
  edgeHolder,
  open,
  droppedAt,
  onOpen,
  onNear,
  onPlace,
  onMode,
}: {
  item: CardItem;
  items: CardItem[];
  task: TaskDTO;
  edgeHolder: CardItem | null;
  open: boolean;
  droppedAt: React.RefObject<number>;
  onOpen: (id: string | null) => void;
  onNear: (id: string | null) => void;
  onPlace: (id: string, place: CardPlace) => void;
  onMode: (id: string, mode: CardMode) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    onOpen(null);
    button.current?.focus();
  }, [onOpen]);
  const boxRef = useDismiss<HTMLSpanElement>(close, open);
  const where = item.place === "off" ? "not on the card" : CARD_PLACE_LABEL[item.place];
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: item.id, disabled: item.fixed });
  const hold = useCallback(
    (node: HTMLSpanElement | null) => {
      boxRef.current = node;
      setNodeRef(node);
    },
    [boxRef, setNodeRef],
  );
  const handle = useCallback(
    (node: HTMLButtonElement | null) => {
      button.current = node;
      setActivatorNodeRef(node);
    },
    [setActivatorNodeRef],
  );

  return (
    <span
      className={`${styles.chipHold} ${isDragging ? styles.chipHoldLifted : ""}`}
      ref={hold}
      style={{ transform: CSS.Translate.toString(transform) }}
    >
      <button
        {...attributes}
        {...listeners}
        ref={handle}
        type="button"
        className={`${styles.chipButton} ${item.place === "edge" ? styles.chipButtonEdge : ""} ${open ? styles.chipButtonOpen : ""}`}
        data-testid="card-drawn"
        data-item={item.id}
        data-place={item.place}
        aria-pressed={undefined}
        aria-expanded={open}
        aria-label={`${item.name}, ${where.toLowerCase()}`}
        title={item.name}
        onClick={() => {
          if (Date.now() - droppedAt.current < 400) return;
          onOpen(open ? null : item.id);
        }}
        onMouseEnter={() => onNear(item.id)}
        onMouseLeave={() => onNear(null)}
        onFocus={() => onNear(item.id)}
        onBlur={() => onNear(null)}
      >
        <Sample items={items} item={item} task={task} />
      </button>

      {open && (
        <ChipPopover
          item={item}
          items={items}
          task={task}
          edgeHolder={edgeHolder}
          onClose={close}
          onPlace={(place) => {
            onPlace(item.id, place);
            /* The chip moves to another zone, so the popover would open
               somewhere the person did not click. */
            if (place !== "edge") onOpen(null);
          }}
          onMode={(mode) => onMode(item.id, mode)}
        />
      )}
    </span>
  );
}

function ChipPopover({
  item,
  items,
  task,
  edgeHolder,
  onClose,
  onPlace,
  onMode,
}: {
  item: CardItem;
  items: CardItem[];
  task: TaskDTO;
  edgeHolder: CardItem | null;
  onClose: () => void;
  onPlace: (place: CardPlace) => void;
  onMode: (mode: CardMode) => void;
}) {
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => self.current?.focus(), []);
  const off = item.place === "off";
  const onEdge = item.place === "edge";
  /* A sample reads in a place a chip can sit, so the edge and "off" draw it
     as the footer would. */
  const sampleAt: CardPlace =
    item.place === "edge" || item.place === "off" || item.place === "title"
      ? item.kind === "desc"
        ? "body"
        : "footerL"
      : item.place;

  return (
    <div
      ref={self}
      className={styles.chipPop}
      role="dialog"
      aria-label={`${item.name} on the card`}
      tabIndex={-1}
      data-testid="chip-popover"
    >
      <div className={styles.chipPopHead}>
        <span className={styles.chipPopName}>{item.name}</span>
        <span className={styles.chipPopWhere}>
          {off ? "Not on the card" : CARD_PLACE_LABEL[item.place]}
        </span>
        <span style={{ flex: 1 }} />
        <IconButton label={`Close ${item.name}`} title="Close" onClick={onClose}>
          ✕
        </IconButton>
      </div>

      <div className={styles.chipPopField}>
        <span className={styles.chipPopLabel}>Reads as</span>
        <span className={styles.chipPopModes} role="group" aria-label={`How ${item.name} reads`}>
          {MODES_FOR_KIND[item.kind].map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`${styles.modeSample} ${item.mode === mode.id ? styles.modeSampleOn : ""}`}
              aria-pressed={item.mode === mode.id}
              aria-label={mode.label}
              title={mode.label}
              onClick={() => onMode(mode.id)}
            >
              <Sample
                items={items}
                item={{ ...item, mode: mode.id, place: sampleAt }}
                task={task}
              />
            </button>
          ))}
        </span>
      </div>

      {canEdge(item.kind) && (
        <div className={styles.chipPopField}>
          <Checkbox
            role="switch"
            label="Colour the edge of the card"
            checked={onEdge}
            onChange={() => onPlace(onEdge ? OFF_EDGE : "edge")}
          />
          {!onEdge && edgeHolder && (
            <Note>Taking the edge takes {edgeHolder.name} off the card.</Note>
          )}
        </div>
      )}

      {off ? (
        <div className={styles.chipPopField}>
          <span className={styles.chipPopLabel}>Put it in</span>
          <span className={styles.chipPopPlaces}>
            {CHIP_PLACES.map((place) => (
              <Button
                key={place}
                variant="ghost"
                aria-label={`Put ${item.name} in the ${CARD_PLACE_LABEL[place].toLowerCase()}`}
                onClick={() => onPlace(place)}
              >
                {CARD_PLACE_LABEL[place]}
              </Button>
            ))}
          </span>
        </div>
      ) : (
        <div className={styles.chipPopFoot}>
          <Button variant="ghost" onClick={() => onPlace("off")}>
            Take off the card
          </Button>
          <span style={{ flex: 1 }} />
          <Note>saves as you click</Note>
        </div>
      )}
    </div>
  );
}

/**
 * One row drawn as the board draws it, on the stand-in task. A row that
 * holds nothing to draw, such as a select with no options yet, shows its
 * name, so there is still something to click.
 */
function Sample({ items, item, task }: { items: CardItem[]; item: CardItem; task: TaskDTO }) {
  const { data } = useBoard();
  const slots = useMemo(
    () => buildOne(items, item, task, data.members, data.former, data.project.timeZone),
    [data.former, data.members, data.project.timeZone, item, items, task],
  );

  if (item.place === "edge") {
    return (
      <span
        className={styles.edgeSample}
        style={slots.edge ? { background: slots.edge } : undefined}
        aria-hidden
      />
    );
  }
  if (slots.body) {
    return (
      <span className={styles.descSample} style={{ WebkitLineClamp: slots.body.lines }}>
        {slots.body.text}
      </span>
    );
  }
  const chips = [
    ...slots.headerL,
    ...slots.headerR,
    ...slots.bodyChips,
    ...slots.footerL,
    ...slots.footerR,
  ];
  if (!chips.length) return <span className={styles.emptySample}>{item.name}</span>;
  return (
    <span className={styles.chipSample}>
      {chips.map((chip) => (
        <Chip key={chip.key} chip={chip} />
      ))}
    </span>
  );
}
