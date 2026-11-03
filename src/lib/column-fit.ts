/**
 * The arithmetic of dragging a list's column wider or narrower. Pure, so it is
 * tested without a browser; `ListCanvas` measures the row, runs `dragColumns`
 * and draws what comes back.
 *
 * The row keeps its width while an edge is dragged. A column that grows takes
 * its room from the space after the last column first, and then from the
 * columns to its right, each in proportion to its width, down to their
 * minimums. That is where the drag stops. A column that shrinks gives its room
 * to the space at the end. So a drag never pushes the table off the window,
 * and never leaves a column narrower than anybody could read.
 */

/** A column as a drag sees it: its width now, and whether it may give or take space. */
export type DragColumn = {
  id: string;
  width: number;
  min: number;
  resizable: boolean;
};

/**
 * The id of the empty track after the last column. It gives first and takes
 * everything given back, because it is room nobody is using.
 */
export const REST = "_rest";

type Item = { id: string; base: number; min: number };

/**
 * Widths for `items` that add up to exactly `total`, each proportional to its
 * `base` and none below its `min`. An item that would fall below its minimum is
 * held there and the rest are scaled again without it. If the minimums alone
 * exceed `total`, every item is at its minimum.
 *
 * Whole pixels out: the fractions are floored and the pixels left over go one
 * each to the items that lost the most, so the sum is exact.
 */
export function scaleToFill(items: readonly Item[], total: number): Map<string, number> {
  const out = new Map<string, number>();
  if (items.length === 0) return out;
  const mins = items.reduce((sum, item) => sum + item.min, 0);
  if (total <= mins) {
    for (const item of items) out.set(item.id, item.min);
    return out;
  }

  const held = new Set<string>();
  let exact = new Map<string, number>();
  for (;;) {
    const free = items.filter((item) => !held.has(item.id));
    const budget = total - items.reduce((sum, item) => sum + (held.has(item.id) ? item.min : 0), 0);
    const bases = free.reduce((sum, item) => sum + Math.max(item.base, 0), 0);
    exact = new Map();
    let clamped = false;
    for (const item of items) {
      if (held.has(item.id)) {
        exact.set(item.id, item.min);
        continue;
      }
      // All-zero bases share the budget evenly rather than divide by nothing.
      const width = bases > 0 ? (Math.max(item.base, 0) / bases) * budget : budget / free.length;
      if (width < item.min) {
        held.add(item.id);
        clamped = true;
      }
      exact.set(item.id, width);
    }
    if (!clamped) break;
  }

  let left = Math.round(total);
  const floors = items.map((item) => {
    const width = exact.get(item.id) ?? item.min;
    const floor = Math.max(Math.floor(width), item.min);
    left -= floor;
    return { id: item.id, floor, lost: width - floor };
  });
  floors.sort((a, b) => b.lost - a.lost);
  for (const entry of floors) {
    const extra = left > 0 ? 1 : 0;
    left -= extra;
    out.set(entry.id, entry.floor + extra);
  }
  return out;
}

/**
 * The widths a drag leaves, once the dragged column has been set to wherever
 * the pointer is. `total` is the width the row must keep, the room at the end
 * included.
 *
 * What the dragged column took past `total` comes out of the room at the end
 * first, then out of the resizable columns to its right, in proportion. With
 * no column to its right — the last one — the columns to its left give
 * instead. What the donors cannot give, being at their minimums, is taken
 * back from the dragged column: that is where the drag stops. What the dragged
 * column gave back goes to the room at the end.
 *
 * Stateless: it only compares the row with `total`, so it needs no memory of
 * where the drag began. Returns only the widths that change.
 */
export function dragColumns(
  columns: readonly DragColumn[],
  draggedId: string,
  total: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const index = columns.findIndex((column) => column.id === draggedId);
  if (index < 0) return out;
  const dragged = columns[index];
  let overflow = columns.reduce((sum, column) => sum + column.width, 0) - total;
  if (overflow === 0) return out;

  const rest = columns.find((column) => column.id === REST);

  if (overflow < 0) {
    if (rest) out.set(REST, rest.width - overflow);
    else out.set(dragged.id, dragged.width - overflow);
    return out;
  }

  if (rest && rest.width > 0) {
    const taken = Math.min(overflow, rest.width);
    out.set(REST, rest.width - taken);
    overflow -= taken;
    if (overflow === 0) return out;
  }

  const giving = (column: DragColumn) => column.resizable && column.id !== REST;
  const right = columns.slice(index + 1).filter(giving);
  const donors = right.length > 0 ? right : columns.slice(0, index).filter(giving);
  const room = donors.reduce((sum, column) => sum + column.width - column.min, 0);
  const settled = Math.min(overflow, room);

  if (settled > 0) {
    const donorWidth = donors.reduce((sum, column) => sum + column.width, 0);
    const next = scaleToFill(
      donors.map((column) => ({ id: column.id, base: column.width, min: column.min })),
      donorWidth - settled,
    );
    for (const column of donors) {
      const width = next.get(column.id);
      if (width !== undefined && width !== column.width) out.set(column.id, width);
    }
  }

  const width = Math.max(dragged.width - (overflow - settled), dragged.min);
  if (width !== dragged.width) out.set(dragged.id, width);
  return out;
}
