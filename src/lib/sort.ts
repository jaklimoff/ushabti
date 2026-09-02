import type { CardItem } from "./card-view";
import { KIND_OF_BUILTIN, KIND_OF_TYPE } from "./card-view";
import {
  CARD_BUILTINS,
  SORT_DIRECTIONS,
  type CardBuiltin,
  type MemberDTO,
  type PropertyDTO,
  type SortDirection,
  type TaskDTO,
  type ViewSort,
} from "./types";

/**
 * How a list is ordered when somebody has asked for an order.
 *
 * Nothing here names a property either. A sort holds the id of a column — a
 * property, or one of the parts a task has of its own — and the kind behind it
 * says how two of those compare. Adding a property type means one line in
 * `KIND_OF_TYPE`, exactly as it does for a card.
 *
 * A sort writes nothing. The rank a task carries is the one order every view
 * shares, and it stays where it is; this decides only what a list draws. Which
 * is why a sorted list cannot be dragged: a drag would write an order into a
 * list that is not showing one.
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
 * The tasks a list draws, in the order it was asked for.
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

/** What the chip says: the column, and which way it runs. */
export function sortLabel(sort: ViewSort, columns: CardItem[]): string {
  const item = columns.find((c) => c.id === sort.columnId);
  return item ? item.name : "";
}

/**
 * Whether a column can be ordered at all. Everything a list draws can, which
 * is the point of this file, but a kind with nothing to compare would say so
 * here rather than at every heading.
 */
export function canSort(item: CardItem): boolean {
  const kind = item.property
    ? KIND_OF_TYPE[item.property.type]
    : KIND_OF_BUILTIN[item.id as CardBuiltin];
  return kind !== "desc";
}
