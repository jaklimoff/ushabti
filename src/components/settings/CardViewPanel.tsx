"use client";

import { useMemo, useState } from "react";
import { useBoard } from "@/components/board/store";
import { TaskCard } from "@/components/board/TaskCard";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, Foot, Note, Tag } from "@/components/ui/Layout";
import {
  canEdge,
  MODES_FOR_KIND,
  moveCardRow,
  previewTasks,
  setCardMode,
  setCardPlace,
  viewOf,
  type CardItem,
} from "@/lib/card-view";
import {
  CARD_PLACE_LABEL,
  PROPERTY_TYPE_LABEL,
  type CardMode,
  type CardPlace,
  type CardView,
} from "@/lib/types";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

export function CardViewPanel() {
  const { cardItems, setCardView, resetCardView } = useBoard();
  const [open, setOpen] = useState<string | null>(null);

  /* A click says what the whole card view becomes, not what one row does. */
  const view: CardView = useMemo(() => viewOf(cardItems), [cardItems]);

  const shown = cardItems.filter((i) => i.place !== "off").length;
  const edge = cardItems.find((i) => i.place === "edge") ?? null;

  return (
    <>
      <PageHead
        title="Card view"
        note="What a card on the board carries. Open a row to say how it reads and where it sits, and move rows to change the order — rows sharing a place sit in list order."
      />

      <div className={styles.cardLayout}>
        <Card>
          <div className={styles.cardHead}>
            <span className={styles.cardHeadName}>Shows on the card</span>
            <span className={styles.cardHeadType}>Type</span>
            <span className={styles.cardHeadPlace}>On card</span>
          </div>

          {cardItems.map((item, index) => (
            <CardRowBox
              key={item.id}
              item={item}
              edgeHolder={edge}
              open={open === item.id}
              first={index === 0}
              last={index === cardItems.length - 1}
              onToggle={() => setOpen((current) => (current === item.id ? null : item.id))}
              onClose={() => setOpen(null)}
              onPlace={(place) => void setCardView(setCardPlace(view, item.id, place))}
              onMode={(mode) => void setCardView(setCardMode(view, item.id, mode))}
              onMove={(by) => void setCardView(moveCardRow(view, item.id, by))}
            />
          ))}

          <Foot>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(null);
                void resetCardView();
              }}
            >
              Reset to default
            </Button>
            <span style={{ flex: 1 }} />
            <Note>
              {shown} of {cardItems.length} on the card
            </Note>
          </Foot>
        </Card>

        <Preview />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One row                                                             */
/* ------------------------------------------------------------------ */

function CardRowBox({
  item,
  edgeHolder,
  open,
  first,
  last,
  onToggle,
  onClose,
  onPlace,
  onMode,
  onMove,
}: {
  item: CardItem;
  edgeHolder: CardItem | null;
  open: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPlace: (place: CardPlace) => void;
  onMode: (mode: CardMode) => void;
  onMove: (by: -1 | 1) => void;
}) {
  const off = item.place === "off";
  const modes = MODES_FOR_KIND[item.kind];

  let hint: string;
  if (item.fixed) hint = "The title always sits under the header. It cannot move or come off.";
  else if (item.place === "edge")
    hint = "A stripe down the left. Colour only, one property at a time.";
  else if (!canEdge(item.kind)) hint = "No colours of its own, so the edge stripe is out.";
  else if (edgeHolder && edgeHolder.id !== item.id)
    hint = `Taking the edge takes ${edgeHolder.name} off the card.`;
  else hint = "Choose a box. Left and right are the two ends of the same row.";

  return (
    <div className={styles.cardRowBox} data-testid="card-row" data-place={item.place}>
      <div className={styles.cardRow}>
        <span className={styles.cardRowMove}>
          <IconButton
            label={`Move ${item.name} up`}
            title="Move up"
            disabled={first}
            onClick={() => onMove(-1)}
          >
            ↑
          </IconButton>
          <IconButton
            label={`Move ${item.name} down`}
            title="Move down"
            disabled={last}
            onClick={() => onMove(1)}
          >
            ↓
          </IconButton>
        </span>

        <span className={styles.cardRowName}>
          <span className={styles.cardRowDot} style={{ background: item.color }} />
          <span className={off ? styles.cardRowOff : undefined}>{item.name}</span>
          {item.builtin && <span className={styles.cardRowNote}>built in</span>}
        </span>

        <span className={styles.cardRowType}>
          <Tag>{item.property ? PROPERTY_TYPE_LABEL[item.property.type] : "Task"}</Tag>
        </span>

        <button
          type="button"
          className={`${styles.placeCell} ${open ? styles.placeCellOpen : ""}`}
          aria-expanded={open}
          aria-label={`${item.name} on the card: ${CARD_PLACE_LABEL[item.place]}`}
          title={item.fixed ? "The title cannot move" : "Choose how it reads and where it sits"}
          disabled={item.fixed}
          onClick={onToggle}
        >
          {!off && !item.fixed && (
            <span
              className={item.place === "edge" ? styles.placeCellBar : styles.placeCellDot}
              style={{ background: item.color }}
            />
          )}
          <span className={off ? styles.cardRowOff : undefined}>
            {CARD_PLACE_LABEL[item.place]}
          </span>
        </button>
      </div>

      {open && (
        <div className={styles.cardEditor} data-testid="card-editor">
          <div className={styles.cardEditorHead}>
            <span className={styles.cardEditorTitle}>{item.name} on the card</span>
            <span style={{ flex: 1 }} />
            <IconButton label={`Close ${item.name}`} title="Close" onClick={onClose}>
              ✕
            </IconButton>
          </div>

          <div className={styles.cardField}>
            <span className={styles.cardFieldLabel}>Reads as</span>
            <span className={styles.modes} role="group" aria-label={`How ${item.name} reads`}>
              {modes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={`${styles.mode} ${item.mode === mode.id ? styles.modeOn : ""}`}
                  aria-pressed={item.mode === mode.id}
                  onClick={() => onMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </span>
          </div>

          <div className={styles.cardField}>
            <span className={styles.cardFieldLabel}>Place</span>
            <PlaceGrid item={item} edgeHolder={edgeHolder} onPlace={onPlace} />
          </div>

          <Note>{hint}</Note>

          <div className={styles.cardEditorFoot}>
            {!off && (
              <Button
                variant="ghost"
                onClick={() => {
                  onPlace("off");
                  onClose();
                }}
              >
                Take off the card
              </Button>
            )}
            <span style={{ flex: 1 }} />
            <Note>saves as you click</Note>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The card, drawn small enough to click. Each box is one place, and the title
 * bar sits between the header and the body because that is where it always is.
 */
function PlaceGrid({
  item,
  edgeHolder,
  onPlace,
}: {
  item: CardItem;
  edgeHolder: CardItem | null;
  onPlace: (place: CardPlace) => void;
}) {
  const cell = (place: CardPlace, label: string, className: string) => {
    const on = item.place === place;
    const allowed = place !== "edge" || canEdge(item.kind);
    const taken = place === "edge" && edgeHolder && edgeHolder.id !== item.id;
    return (
      <button
        type="button"
        className={`${className} ${on ? styles.placeOn : ""}`}
        aria-pressed={on}
        aria-label={`Put ${item.name} in the ${CARD_PLACE_LABEL[place].toLowerCase()}`}
        disabled={!allowed}
        title={
          !allowed
            ? "The edge carries colour only"
            : taken
              ? `Edge stripe — ${edgeHolder.name} has it`
              : CARD_PLACE_LABEL[place]
        }
        onClick={() => onPlace(place)}
      >
        {label}
      </button>
    );
  };

  return (
    <span className={styles.placeGrid}>
      {cell("edge", "", styles.placeEdge)}
      <span className={styles.placeCard}>
        <span className={styles.placeRow}>
          {cell("headerL", "L", styles.placeBox)}
          {cell("headerR", "R", styles.placeBox)}
        </span>
        <span className={styles.placeTitle} title="The title never moves" />
        {cell("body", "BODY", styles.placeWide)}
        <span className={styles.placeRow}>
          {cell("footerL", "L", styles.placeBox)}
          {cell("footerR", "R", styles.placeBox)}
        </span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The card itself                                                     */
/* ------------------------------------------------------------------ */

/**
 * The board's own card component, drawn from the same card view the board
 * reads. A preview that draws itself would drift from the board within a
 * release; this one cannot.
 */
function Preview() {
  const { data } = useBoard();
  const tasks = useMemo(
    () => previewTasks(data.tasks, data.properties, data.members, data.project.key),
    [data.members, data.project.key, data.properties, data.tasks],
  );

  return (
    <aside className={styles.preview} aria-label="What a card looks like">
      <div className={styles.previewHead}>
        <span className={styles.previewTitle}>On the board</span>
        <span className={styles.previewLive}>live</span>
      </div>
      <div className={styles.previewCards}>
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
      <Note>
        A card only draws what a task actually holds, so a task with no due date has a shorter
        footer than the one beside it.
      </Note>
    </aside>
  );
}
