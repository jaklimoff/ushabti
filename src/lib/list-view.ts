import type { CardItem } from "./card-view";
import type { CardBuiltin, CardMode, PropertyType } from "./types";

/**
 * What a list carries, and how wide.
 *
 * A list row is the card view read across instead of down: the same rows, in
 * the same order, drawn by the same chips. So nothing here names a property
 * either, and there is no second place to arrange one — the card view page
 * arranges both. Adding a property type means one line in `WIDTH_OF_TYPE`.
 */

/** One column of a list: a row of the card view, given a width. */
export type ListColumn = {
  id: string;
  name: string;
  item: CardItem;
  /** Pixels. The title alone is flexible and carries 0. */
  width: number;
  /** A number reads from the right, so its column does too. */
  right: boolean;
  /**
   * How far from the left this column stays put while the list scrolls
   * sideways, or null for a column that scrolls away. Only the key and the
   * title are held: with the panel open a wide list scrolls, and a row whose
   * name has gone is a row you cannot identify.
   */
  pin: number | null;
};

/** How wide the title may be squeezed before the whole list scrolls sideways. */
export const TITLE_MIN_WIDTH = 200;

/**
 * How wide the title is allowed to grow. Without a ceiling it takes every
 * pixel the window has spare and pushes the properties into a huddle at the
 * far right, which is the one thing a person came to a list to compare.
 */
export const TITLE_MAX_WIDTH = 520;

/**
 * The narrowest a column may be. A cell can afford to be small — an avatar is
 * 17 px, a comment count is one digit — but the heading above it still has to
 * name the property, and a column headed ASSIGN teaches nobody anything.
 */
const HEADING_WIDTH = 66;

/** The gap between two columns. It has to be known to pin one. */
const LIST_GAP = 8;

/**
 * How much room a value needs. This keys off the property type and not off the
 * card kind, because width is about the shape of the content rather than how
 * it reads: a number is short where the text beside it is long, and the two
 * share a kind.
 */
const WIDTH_OF_TYPE: Record<PropertyType, number> = {
  select: 112,
  multi_select: 156,
  person: 140,
  date: 84,
  checkbox: 96,
  text: 168,
  number: 76,
};

/**
 * A mode that draws no words needs far less room. Only the avatar is left: a
 * face is recognised, where a bare colour has to be learnt, so `buildRow` gives
 * a colour-only chip its name back and this gives it the room for one.
 */
const WIDTH_OF_MODE: Partial<Record<CardMode, number>> = {
  avatar: HEADING_WIDTH,
};

const WIDTH_OF_BUILTIN: Record<CardBuiltin, number> = {
  _key: 72,
  _title: 0,
  _desc: 0,
  _checklist: 72,
  _comments: HEADING_WIDTH,
};

function widthOf(item: ListColumn["item"]): number {
  if (!item.property) return WIDTH_OF_BUILTIN[item.id as CardBuiltin] ?? 96;
  const byMode = WIDTH_OF_MODE[item.mode];
  /* A multi-select in colour mode still draws several swatches. */
  if (byMode !== undefined) return item.property.type === "multi_select" ? byMode + 38 : byMode;
  return WIDTH_OF_TYPE[item.property.type];
}

/**
 * The columns of a list, settled the way `readCardView` settles a card.
 *
 * A row that is off the card is off the list. The edge is the stripe down the
 * side, not a column. The description joins the title, because a line has one
 * line. The key opens the row and the title follows it, because a table is
 * read from the left and the name of the task is what somebody looks for.
 *
 * The five places of a card collapse here. `headerL`, `body`, `footerR` and
 * the rest all mean "a column", in card-view order: a place says where a chip
 * sits on a card, and a row is one line. Only `off` and `edge` still say
 * anything, which is why the card view page needs no new place and no new mode.
 */
export function listColumns(items: CardItem[]): ListColumn[] {
  const columns: ListColumn[] = [];

  for (const item of items) {
    if (item.place === "off" || item.place === "edge") continue;
    if (item.id === "_desc") continue;

    columns.push({
      id: item.id,
      name: item.name,
      item,
      width: item.id === "_title" ? 0 : widthOf(item),
      right: item.property?.type === "number",
      pin: null,
    });
  }

  /* The title always sits on the list, exactly as it always sits on the card:
     a row of nothing but chips names nothing. */
  if (!columns.some((c) => c.id === "_title")) {
    const title = items.find((i) => i.id === "_title");
    if (title) {
      columns.unshift({
        id: "_title",
        name: title.name,
        item: title,
        width: 0,
        right: false,
        pin: null,
      });
    }
  }

  const lead = (id: string) => {
    const at = columns.findIndex((c) => c.id === id);
    if (at > 0) columns.unshift(columns.splice(at, 1)[0]);
  };
  lead("_title");
  lead("_key");

  /* The leading run of key and title stays put. The gap between two columns
     belongs to the one on its left, so a pinned cell covers it and nothing
     shows through the seam. */
  let left = 0;
  for (const column of columns) {
    if (column.id !== "_key" && column.id !== "_title") break;
    column.pin = left;
    left += column.width + LIST_GAP;
  }

  return columns;
}

/**
 * The one grid template the header and every row share. Written once onto the
 * scroller as a custom property, so a column and its heading cannot drift.
 *
 * It ends in a track nothing is drawn in. Every column has a width of its own,
 * so something has to take up the slack on a wide window, and a table takes it
 * at the end — the alternative is the title growing to half the screen and the
 * properties huddling at the far right.
 */
export function listTemplate(columns: ListColumn[]): string {
  const tracks = columns.map((c) =>
    c.width === 0 ? `minmax(${TITLE_MIN_WIDTH}px, ${TITLE_MAX_WIDTH}px)` : `${c.width}px`,
  );
  return [...tracks, "1fr"].join(" ");
}
