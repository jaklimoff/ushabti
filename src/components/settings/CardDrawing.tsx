"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
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

/**
 * The card editor's own view: one card drawn big, each row as its chip in the
 * place it sits, and a click on a chip to change it. Every change is one of
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

  const chipOf = (item: CardItem) => (
    <ChipButton
      key={item.id}
      item={item}
      items={items}
      task={task}
      edgeHolder={edgeHolder}
      open={open === item.id}
      onOpen={onOpen}
      onNear={onNear}
      onPlace={onPlace}
      onMode={onMode}
    />
  );

  const zone = (place: ChipPlace, wide = false) => {
    const here = drawOrder(items.filter((i) => i.place === place));
    return (
      <div
        className={`${styles.zone} ${wide ? styles.zoneWide : ""}`}
        data-testid={`card-zone-${place}`}
      >
        <span className={styles.zoneLabel}>{ZONE_LABEL[place]}</span>
        {here.length ? (
          <span className={styles.zoneChips}>{here.map(chipOf)}</span>
        ) : (
          <span className={styles.zoneEmpty}>{ZONE_EMPTY[place]}</span>
        )}
      </div>
    );
  };

  return (
    <div className={styles.drawing} data-testid="card-drawing">
      <div className={styles.bigCard}>
        <div className={styles.edgeRail} data-testid="card-zone-edge">
          <span className={styles.edgeRailLabel}>Edge</span>
          {edgeHolder && chipOf(edgeHolder)}
        </div>
        <div className={styles.bigFace}>
          <div className={styles.zoneRow}>
            {zone("headerL")}
            {zone("headerR")}
          </div>
          <div className={styles.zoneTitle} data-testid="card-zone-title">
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

      <div className={styles.offCard} data-testid="card-off">
        <span className={styles.zoneLabel}>Not on the card</span>
        {off.length ? (
          <span className={styles.zoneChips}>{off.map(chipOf)}</span>
        ) : (
          <span className={styles.zoneEmpty}>Everything is on the card.</span>
        )}
      </div>
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
  const box = useDismiss<HTMLSpanElement>(close, open);
  const where = item.place === "off" ? "not on the card" : CARD_PLACE_LABEL[item.place];

  return (
    <span className={styles.chipHold} ref={box}>
      <button
        ref={button}
        type="button"
        className={`${styles.chipButton} ${item.place === "edge" ? styles.chipButtonEdge : ""} ${open ? styles.chipButtonOpen : ""}`}
        data-testid="card-drawn"
        data-item={item.id}
        data-place={item.place}
        aria-expanded={open}
        aria-label={`${item.name}, ${where.toLowerCase()}`}
        title={item.name}
        onClick={() => onOpen(open ? null : item.id)}
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
