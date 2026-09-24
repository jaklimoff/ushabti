import type { CardItem } from "./card-view";
import { KIND_OF_BUILTIN, KIND_OF_TYPE } from "./card-view";
import {
  CARD_BUILTINS,
  SORT_DIRECTIONS,
  type CardBuiltin,
  type CardKind,
  type MemberDTO,
  type PropertyDTO,
  type SortDirection,
  type TaskDTO,
  type ViewSort,
} from "./types";

/**
 * How a view is ordered when somebody has asked for an order.
 *
 * One file for both shapes: a list draws its rows in this order, and a board
 * draws the cards inside every one of its columns in it. Nothing here names a
 * property either. A sort holds the id of a column — a property, or one of the
 * parts a task has of its own — and the kind behind it says how two of those
 * compare. Adding a property type means one line in `KIND_OF_TYPE`, exactly as
 * it does for a card.
 *
 * A sort writes nothing. The rank a task carries is the one order every view
 * shares, and it stays where it is; this decides only what a screen draws.
 * Which is why a sorted view cannot be dragged into another order: the drag
 * would write an order that screen is not showing.
 */

/**
 * The words are compared through one named collator and never through the
 * default locale.
 *
 * The list is drawn on the server and again in the browser, and
 * `localeCompare` with no locale asks the runtime — the locale of the Node
 * process on one side and the browser's on the other. Two different orders,
 * and React throws the server tree away. This is the same reason the month
 * names in `board.ts` are written out by hand.
 *
 * `numeric` is worth having on its own: it puts "Task 9" before "Task 10".
 */
const WORDS = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** What one task is worth for one column, or null when it holds nothing. */
type SortKey = string | number | boolean | null;

function isDirection(raw: unknown): raw is SortDirection {
  return typeof raw === "string" && (SORT_DIRECTIONS as readonly string[]).includes(raw);
}

/**
 * A saved sort, made safe to draw — read afresh every time, exactly as a
 * filter is. Nothing rewrites a view when the property its sort names is
 * deleted, so a saved sort can point at nothing, and an order nobody can see
 * must never keep deciding what a list looks like.
 */
export function readSort(raw: unknown, properties: PropertyDTO[]): ViewSort | null {
  if (!raw || typeof raw !== "object") return null;
  const sort = raw as Partial<ViewSort>;
  if (typeof sort.columnId !== "string" || !isDirection(sort.direction)) return null;

  const known =
    (CARD_BUILTINS as readonly string[]).includes(sort.columnId) ||
    properties.some((p) => p.id === sort.columnId);
  if (!known) return null;

  /* The description is not a column of a list, so it is not an order either. */
  if (sort.columnId === "_desc") return null;

  return { columnId: sort.columnId, direction: sort.direction };
}

/**
 * What one press on a heading does: down, then up, then back to the order the
 * board itself keeps.
 *
 * The third press matters more than it looks. The rank every view shares is
 * the only order a drag can write, so a person who sorts a list has to be able
 * to get back to it — and the heading they sorted with is where they will look
 * for the way back.
 */
export function nextSort(current: ViewSort | null, columnId: string): ViewSort | null {
  if (!current || current.columnId !== columnId) return { columnId, direction: "asc" };
  if (current.direction === "asc") return { columnId, direction: "desc" };
  return null;
}

function sameSort(a: ViewSort | null, b: ViewSort | null): boolean {
  if (!a || !b) return a === b;
  return a.columnId === b.columnId && a.direction === b.direction;
}

/**
 * What one press writes on my lens, when the view may carry an order of its
 * own for everybody.
 *
 * A sort a person picks is theirs, exactly as a filter is, and it wins over
 * the view's while it exists. So "back to the board's order" on my lens means
 * no sort of mine, and the screen falls back to the view's. Two turns keep
 * that honest. A press that would land on the view's own order writes nothing
 * of mine, because a lens that repeats the view says nothing. And a press that
 * would change nothing on the screen — the view's order is showing and mine
 * would fall back to it — turns the order around instead, because a press
 * that does nothing reads as broken.
 *
 * `current` is the order on the screen, mine or else the view's.
 */
export function pressSort(
  current: ViewSort | null,
  ofView: ViewSort | null,
  columnId: string,
): ViewSort | null {
  let next = nextSort(current, columnId);
  if (!next && sameSort(ofView, current) && current) {
    next = { columnId, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return sameSort(next, ofView) ? null : next;
}

/**
 * The sort a lens row holds, read as a view's is. It lives in the row's
 * `filters` next to the rules, so a lens is still one row and one write.
 */
export function readLensSort(raw: unknown, properties: PropertyDTO[]): ViewSort | null {
  if (!raw || typeof raw !== "object") return null;
  return readSort((raw as { sort?: unknown }).sort, properties);
}

/** What a task is worth for one column. Empty is null, whatever its type. */
function keyOf(item: CardItem, task: TaskDTO, members: MemberDTO[]): SortKey {
  switch (item.kind) {
    case "id":
      return task.number;
    case "title":
      return task.title.trim() || null;
    case "desc":
      return task.description.trim() || null;
    case "checklist":
      /* How far along, not how many: three of four is further than three of
         ten. A task with no checklist holds nothing. */
      return task.checklistTotal === 0 ? null : task.checklistDone / task.checklistTotal;
    case "comments":
      return task.commentCount || null;
    default:
      break;
  }

  const property = item.property;
  if (!property) return null;
  const value = task.values[property.id];
  if (value === null || value === undefined || value === "") return null;

  switch (item.kind) {
    case "select": {
      /* Options are ordered by hand, and that order is the meaning: Urgent
         above Low, not alphabetically between High and Medium. So a select is
         worth where it sits in its own list.

         A multi-select is worth its highest option, so a task labelled both
         `bug` and `docs` sorts with the bugs. Its values arrive in whatever
         order somebody clicked them, so the first one would be no answer. */
      const ids = Array.isArray(value) ? value.map(String) : [String(value)];
      let best: number | null = null;
      for (const id of ids) {
        const at = property.options.findIndex((o) => o.id === id);
        if (at < 0) continue;
        if (best === null || at < best) best = at;
      }
      return best;
    }
    case "person": {
      const member = members.find((m) => m.id === value);
      return member ? member.name : null;
    }
    case "date":
      /* An ISO date compares as words and comes out chronological. */
      return String(value);
    case "flag":
      return value === true ? true : null;
    default:
      /* A number is a number. Everything else with words is words — the two
         share a card kind, and here they must not. */
      return property.type === "number" ? Number(value) : String(value);
  }
}

function compareKeys(a: SortKey, b: SortKey): number {
  if (typeof a === "string" && typeof b === "string") return WORDS.compare(a, b);
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
  return Number(a) - Number(b);
}

/**
 * The tasks a view draws, in the order it was asked for.
 *
 * A board asks this once, over the whole board, before the tasks go into their
 * columns: `buildColumns` keeps the order it is given, so one pass is the
 * order inside every column.
 *
 * A task that holds nothing for the column goes last, whichever way the sort
 * runs. Turning the order around is a question about the tasks that have an
 * answer; "nothing yet" is not a small value, and a screen that opened with a
 * page of blanks would be answering a question nobody asked.
 *
 * Two tasks that compare the same keep the rank they already had, so the list
 * never shuffles under a person and always agrees with the board underneath.
 */
export function sortTasks(
  tasks: TaskDTO[],
  sort: ViewSort | null,
  columns: CardItem[],
  members: MemberDTO[],
): TaskDTO[] {
  if (!sort) return tasks;
  const item = columns.find((c) => c.id === sort.columnId);
  if (!item) return tasks;

  const way = sort.direction === "asc" ? 1 : -1;
  const keys = new Map<string, SortKey>();
  for (const task of tasks) keys.set(task.id, keyOf(item, task, members));

  return [...tasks].sort((a, b) => {
    const left = keys.get(a.id) ?? null;
    const right = keys.get(b.id) ?? null;
    if (left === null && right === null) return byPosition(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    const by = compareKeys(left, right);
    return by === 0 ? byPosition(a, b) : by * way;
  });
}

function byPosition(a: TaskDTO, b: TaskDTO): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/**
 * The words for the two ways an order runs, by what the column holds.
 *
 * "Smallest first" is true of a number and nonsense for a title, a status or a
 * due date. So the words key off the card kind, as the order itself does, and
 * the Sort button, a list heading and the chip all read this one table. Three
 * places that chose their own words would say three things about one order.
 *
 * Each pair says what `sortTasks` does. A select runs in the order somebody
 * arranged its options, so that is the name. A key is given out in order, so
 * the lowest key is the oldest task. A flag has one value and an empty, and
 * the empty always goes last, so both ways put the ticked tasks first.
 */
const WAYS_OF_KIND: Record<CardKind, Record<SortDirection, string>> = {
  id: { asc: "Oldest first", desc: "Newest first" },
  title: { asc: "A→Z", desc: "Z→A" },
  desc: { asc: "A→Z", desc: "Z→A" },
  checklist: { asc: "Least done first", desc: "Most done first" },
  comments: { asc: "Fewest first", desc: "Most first" },
  select: { asc: "Option order", desc: "Reverse order" },
  person: { asc: "A→Z", desc: "Z→A" },
  date: { asc: "Earliest first", desc: "Latest first" },
  flag: { asc: "Ticked first", desc: "Ticked first" },
  text: { asc: "A→Z", desc: "Z→A" },
};

/** A number shares the text kind on a card, and here it must not. */
const WAYS_OF_NUMBER: Record<SortDirection, string> = {
  asc: "Smallest first",
  desc: "Largest first",
};

function kindOf(item: CardItem): CardKind {
  return item.property ? KIND_OF_TYPE[item.property.type] : KIND_OF_BUILTIN[item.id as CardBuiltin];
}

/** Which way an order by this column runs, in the words a person reads. */
export function sortWay(item: CardItem, direction: SortDirection): string {
  if (item.property?.type === "number") return WAYS_OF_NUMBER[direction];
  return WAYS_OF_KIND[kindOf(item)][direction];
}

/**
 * The same words inside a sentence. Only a word loses its capital: "A→Z"
 * stays as it is.
 */
export function sortWayInline(item: CardItem, direction: SortDirection): string {
  const way = sortWay(item, direction);
  return /^[A-Z][a-z]/.test(way) ? way[0].toLowerCase() + way.slice(1) : way;
}

/** What the chip says: the column, and which way it runs. */
export function sortLabel(
  sort: ViewSort,
  columns: CardItem[],
): { name: string; way: string } | null {
  const item = columns.find((c) => c.id === sort.columnId);
  return item ? { name: item.name, way: sortWay(item, sort.direction) } : null;
}

/**
 * Whether a column can be ordered at all. Everything a list draws can, which
 * is the point of this file, but a kind with nothing to compare would say so
 * here rather than at every heading.
 */
export function canSort(item: CardItem): boolean {
  return kindOf(item) !== "desc";
}
