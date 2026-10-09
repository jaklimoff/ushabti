/**
 * Where a dragged row lands: a view, a property, an option, or a project on
 * Home. A drag names what it landed on, so this is the one place that works
 * the neighbour out: the list in its new order, and the row the dragged one
 * now sits behind. That id is null at the front of the list; the whole answer
 * is null when the drag changed nothing.
 */
export function landedAfter<T extends { id: string }>(
  list: T[],
  id: string,
  overId: string,
): { ordered: T[]; afterId: string | null } | null {
  const from = list.findIndex((item) => item.id === id);
  const to = list.findIndex((item) => item.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  const ordered = list.filter((item) => item.id !== id);
  ordered.splice(to, 0, list[from]);
  return { ordered, afterId: ordered[to - 1]?.id ?? null };
}
