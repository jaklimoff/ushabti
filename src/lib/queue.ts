import { sortByPosition } from "./board";
import { cardItems, mainBoardGroupById, readCardView } from "./card-view";
import { applyFilters, waitingTasks } from "./filters";
import { sortTasks } from "./sort";
import type { BoardData } from "./types";

export type QueueDTO = {
  view: { id: string; name: string };
  tasks: { id: string; key: string }[];
};

/**
 * The tasks one view shows, in the view's order: the queue an agent works
 * from. It walks the store's own steps — the same card view, the same
 * `applyFilters`, the rank and then `sortTasks` — so the queue and the screen
 * cannot disagree.
 *
 * It reads the view's rules and the view's order and never a lens: a lens is
 * one person's screen, and the queue is the team's. "Me" in a rule is
 * `viewer`, the caller. A board's columns do not reorder it; the order inside
 * every column is this one.
 */
export function viewQueue(data: BoardData, viewId: string, viewer: string): QueueDTO | null {
  const view = data.views.find((v) => v.id === viewId);
  if (!view) return null;

  const groupById = mainBoardGroupById(data.views);
  const projectCardView = readCardView(data.cardView, data.properties, groupById);
  const cardView = readCardView(view.cardView, data.properties, groupById, projectCardView, {
    kind: view.kind,
    groupById: view.groupById,
  });
  const items = cardItems(cardView, data.properties);

  const shown = applyFilters(
    data.tasks,
    view.filters,
    data.properties,
    data.today,
    viewer,
    waitingTasks(data.runs),
    data.project.timeZone,
  );
  const ordered = sortTasks(sortByPosition(shown), view.sort, items, data.members, data.former);

  return {
    view: { id: view.id, name: view.name },
    tasks: ordered.map((t) => ({ id: t.id, key: t.key })),
  };
}
