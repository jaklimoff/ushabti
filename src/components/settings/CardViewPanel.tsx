"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBoard } from "@/components/board/store";
import { TaskCard } from "@/components/board/TaskCard";
import { Button, IconButton, Pill } from "@/components/ui/Button";
import { Card, Foot, Note, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import { Chevron } from "@/components/ui/Marks";
import {
  canEdge,
  cardItems as itemsOf,
  defaultCardView,
  mainBoardGroupById,
  MODES_FOR_KIND,
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
import { CardDrawing } from "./CardDrawing";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

/**
 * The editor for the project's card view, or for one view's own copy when it
 * is given a view. It is the same editor either way, so a view's card cannot
 * be arranged in a way the project's cannot. The first change to a view that
 * has no copy writes one, made from the card it was drawing.
 */
export function CardViewPanel({ viewId = null }: { viewId?: string | null }) {
  const { data, cardItemsOf, setCardView, resetCardView } = useBoard();
  /* The drawing is the way a pointer arranges the card; the list is the same
     editor as rows, and stays whole for the keyboard and a screen reader. */
  const [shape, setShape] = useState<"card" | "list">("card");
  const [open, setOpen] = useState<string | null>(null);
  /* The row under the pointer or the keys. It and the open row point at
     their chip on the preview, so the list and the card read as one. */
  const [near, setNear] = useState<string | null>(null);
  const confirm = useConfirm();
  const target = viewId ? (data.views.find((v) => v.id === viewId) ?? null) : null;
  const cardItems = useMemo(() => cardItemsOf(viewId), [cardItemsOf, viewId]);

  /* The card view is everybody's, so a reset names what it moves: the rows
     whose place or reading differ from the default. The default is the one the
     store puts back, worked out the same way. There is no order to count: it
     is the order of the properties, and a reset leaves that alone. */
  const changed = useMemo(() => {
    const fresh = itemsOf(
      defaultCardView(data.properties, mainBoardGroupById(data.views)),
      data.properties,
    );
    return cardItems.filter((item) => {
      const other = fresh.find((f) => f.id === item.id);
      return !other || other.place !== item.place || other.mode !== item.mode;
    }).length;
  }, [cardItems, data.properties, data.views]);

  /* A click says what the whole card view becomes, not what one row does. */
  const view: CardView = useMemo(() => viewOf(cardItems), [cardItems]);

  const shown = cardItems.filter((i) => i.place !== "off").length;
  const edge = cardItems.find((i) => i.place === "edge") ?? null;

  if (viewId && !target) {
    return (
      <>
        <PageHead title="Card view" note="This view is gone." />
        <Link href={`/p/${data.project.id}/settings/views`}>Back to the views</Link>
      </>
    );
  }

  const own = target?.cardView != null;
  const kindSaid = target?.kind === "list" ? "row of this list" : "card of this board";

  return (
    <>
      {target ? (
        <div className={styles.subHead}>
          {/* The rail lights Views, and this is the way back to it. */}
          <Link className={styles.backLink} href={`/p/${data.project.id}/settings/views`}>
            <Chevron size={10} className={styles.backChevron} />
            Views
          </Link>
          <PageHead
            title={
              <span className={styles.cardTitleRow}>
                Card view of {target.name}
                {/* The lead says it in words; the tag says it at a glance. */}
                <span aria-hidden className={styles.cardTitleTag}>
                  {own ? <Tag accent>own copy</Tag> : <Tag>follows the project</Tag>}
                </span>
              </span>
            }
            note={
              own
                ? `What a ${kindSaid} carries. This view keeps a copy of its own, so a change to the project's card view does not reach it.`
                : `What a ${kindSaid} carries. It draws the project's card view now; your first change here gives this view a copy of its own.`
            }
          />
        </div>
      ) : (
        <PageHead
          title="Card view"
          note="What a card on the board carries. Click a chip to say how it reads and where it sits. Chips sharing a place follow the order of the properties, which a drag along a place changes here or in Properties."
        />
      )}

      <div className={styles.shapeToggle} role="group" aria-label="Arrange the card as">
        {(["card", "list"] as const).map((s) => (
          <Pill
            key={s}
            on={shape === s}
            onClick={() => {
              setOpen(null);
              setNear(null);
              setShape(s);
            }}
          >
            {s === "card" ? "Card" : "List"}
          </Pill>
        ))}
      </div>

      <div className={styles.cardLayout}>
        <Card className={shape === "card" ? styles.drawingCard : undefined}>
          {shape === "card" ? (
            <CardDrawing
              items={cardItems}
              open={open}
              onOpen={setOpen}
              onNear={setNear}
              onPlace={(id, place) => void setCardView(setCardPlace(view, id, place), viewId)}
              onMode={(id, mode) => void setCardView(setCardMode(view, id, mode), viewId)}
            />
          ) : (
            <>
              <div className={styles.cardHead}>
                <span className={styles.cardHeadName}>Shows on the card</span>
                <span className={styles.cardHeadType}>Type</span>
                <span className={styles.cardHeadPlace}>On card</span>
              </div>

              {cardItems.map((item) => (
                <CardRowBox
                  key={item.id}
                  item={item}
                  edgeHolder={edge}
                  open={open === item.id}
                  onNear={(on) =>
                    setNear((current) => (on ? item.id : current === item.id ? null : current))
                  }
                  onToggle={() => setOpen((current) => (current === item.id ? null : item.id))}
                  onClose={() => setOpen(null)}
                  onPlace={(place) => void setCardView(setCardPlace(view, item.id, place), viewId)}
                  onMode={(mode) => void setCardView(setCardMode(view, item.id, mode), viewId)}
                />
              ))}
            </>
          )}

          {confirm.asking ? (
            <ConfirmRow
              question={
                target
                  ? `Use the default for ${target.name}? Its own card view goes, and it draws the project's again.`
                  : `Reset the card view for everyone? ${changed} ${changed === 1 ? "row goes" : "rows go"} back to the default.`
              }
              confirmLabel={target ? "Yes, use the default" : "Yes, reset"}
              onConfirm={() => confirm.confirm(() => void resetCardView(viewId))}
              onCancel={confirm.cancel}
            />
          ) : (
            <Foot>
              {target ? (
                own && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setOpen(null);
                      confirm.ask();
                    }}
                  >
                    Use the default
                  </Button>
                )
              ) : (
                <Button
                  variant="ghost"
                  disabled={changed === 0}
                  title={changed === 0 ? "The card view is already the default" : undefined}
                  onClick={() => {
                    setOpen(null);
                    confirm.ask();
                  }}
                >
                  Reset to default
                </Button>
              )}
              <span style={{ flex: 1 }} />
              <Note>
                {shown} of {cardItems.length} on the card
              </Note>
            </Foot>
          )}
        </Card>

        <Preview items={cardItems} lit={near ?? open} />
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
  onNear,
  onToggle,
  onClose,
  onPlace,
  onMode,
}: {
  item: CardItem;
  edgeHolder: CardItem | null;
  open: boolean;
  /** The pointer or the focus came onto the row, or left it. */
  onNear: (on: boolean) => void;
  onToggle: () => void;
  onClose: () => void;
  onPlace: (place: CardPlace) => void;
  onMode: (mode: CardMode) => void;
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
    <div
      className={styles.cardRowBox}
      data-testid="card-row"
      data-place={item.place}
      onMouseEnter={() => onNear(true)}
      onMouseLeave={() => onNear(false)}
      onFocus={() => onNear(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onNear(false);
      }}
    >
      <div className={styles.cardRow}>
        <span className={styles.cardRowName}>
          <span className={off ? styles.cardRowOff : undefined}>{item.name}</span>
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
          {/* The dot says it is on the card, and nothing about which colour:
              the first option's colour read as a status. The edge is colour
              itself, so its bar keeps it. */}
          {!off && !item.fixed && (
            <span
              className={item.place === "edge" ? styles.placeCellBar : styles.placeCellDot}
              style={item.place === "edge" ? { background: item.color } : undefined}
            />
          )}
          <span className={off ? styles.cardRowOff : undefined}>
            {CARD_PLACE_LABEL[item.place]}
          </span>
          {!item.fixed && <Chevron size={10} className={styles.placeCellCaret} />}
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
            <span className={styles.cardFieldBody}>
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
              <Note>{modeSaid(item)}</Note>
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
 * What the picked reading draws, in one sentence. The names of the modes are
 * short, and a newcomer cannot picture "Filled" or "Both" from the word.
 */
function modeSaid(item: CardItem): string {
  const { kind, mode } = item;
  if (kind === "select") {
    if (mode === "both") return "A dot of the option's colour, then its name, in a thin box.";
    if (mode === "fill") return "The option's name on a fill of its colour.";
    if (mode === "colour") return "A square of the option's colour, no words.";
    return "The option's name in a thin box, no colour.";
  }
  if (kind === "person") {
    if (mode === "avatar") return "Their face, no name.";
    if (mode === "text") return "Their name, no face.";
    return "Their face and their name, in a thin box.";
  }
  if (kind === "desc")
    return mode === "one"
      ? "The first line of the description."
      : "The first two lines of the description.";
  if (kind === "checklist" || kind === "parts")
    return mode === "bar"
      ? "A small bar of what is done, then the count."
      : "The count alone, as 1/4.";
  if (kind === "comments") return "A speech bubble and the number of comments.";
  if (kind === "title") return "The task's title, on its own line.";
  return mode === "boxed" ? "The words in a thin box." : "The words alone.";
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
function Preview({ items, lit }: { items: CardItem[]; lit: string | null }) {
  const { data } = useBoard();
  const cards = useRef<HTMLDivElement>(null);
  const tasks = useMemo(
    () => previewTasks(data.tasks, data.properties, data.members, data.project.key),
    [data.members, data.project.key, data.properties, data.tasks],
  );

  /* The row a person is on points at its part of the card. The chips say
     which row they were drawn for; the title, the description and the edge
     are the card's own parts and are found by what they are. Marked from
     here, so the card itself still draws and decides nothing. */
  useEffect(() => {
    const root = cards.current;
    const item = items.find((i) => i.id === lit);
    if (!root || !item || item.place === "off") return;
    const selector =
      item.place === "edge"
        ? '[data-testid="card-edge"]'
        : item.id === "_title"
          ? '[data-testid="card-title"]'
          : item.id === "_desc"
            ? `[data-testid="card-desc"], [data-item="_desc"]`
            : `[data-item="${CSS.escape(item.id)}"]`;
    const found = [...root.querySelectorAll(selector)];
    if (!found.length) return;
    for (const el of found) el.setAttribute("data-lit", "");
    root.setAttribute("data-lighting", "");
    return () => {
      for (const el of found) el.removeAttribute("data-lit");
      root.removeAttribute("data-lighting");
    };
  }, [items, lit, tasks]);

  return (
    <aside className={styles.preview} aria-label="What a card looks like">
      <div className={styles.previewHead}>
        <span className={styles.previewTitle}>On the board</span>
        <span className={styles.previewLive}>live</span>
      </div>
      <div className={styles.previewCards} ref={cards}>
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} items={items} />
        ))}
      </div>
      <Note>
        A card only draws what a task actually holds, so a task with no due date has a shorter
        footer than the one beside it.
      </Note>
    </aside>
  );
}
