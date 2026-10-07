import { CURRENT_KEY } from "./filters";
import { NO_VALUE_KEY, type ViewFilters, type ViewKind } from "./types";

/**
 * Sprints in one step.
 *
 * A scrum team needs one property, two views and two filters before it can
 * start. These are ordinary rows, so a team renames or deletes each one as it
 * would any other. The one thing that remembers them is `projects.sprintBy`,
 * the Use sprints switch: "are sprints on?" asks that pointer and never a
 * property's name, so a plain select named Sprint is just a select.
 */

export const SPRINT = "Sprint";
export const SPRINT_BOARD = "Sprint";
export const BACKLOG = "Backlog";

type Named = { id: string; type: string };

/**
 * The iteration this project runs sprints by, made safe to use. Read afresh
 * and never cleaned up, as `typeBy` is: a pointer at a property that is gone,
 * or is no longer an iteration, reads as sprints off.
 */
export function readSprintBy(raw: unknown, properties: readonly Named[]): string | null {
  if (typeof raw !== "string") return null;
  return properties.some((p) => p.id === raw && p.type === "iteration") ? raw : null;
}

/**
 * The iteration Use sprints takes rather than make one: the one the pointer
 * names, or else the first there is. Off clears the pointer and keeps the
 * property, so on again finds it here and makes nothing twice.
 */
export function sprintToReuse(raw: unknown, properties: readonly Named[]): string | null {
  return (
    readSprintBy(raw, properties) ?? properties.find((p) => p.type === "iteration")?.id ?? null
  );
}

export type SprintView = {
  name: string;
  kind: ViewKind;
  groupById: string | null;
  filters: ViewFilters;
};

/**
 * The two views, for the Sprint property and the property the main board
 * groups by. With no board to ask, the sprint board groups by Sprint itself:
 * a board cannot be made without columns, and that is the one property this
 * press is sure of.
 */
export function sprintViews(sprintId: string, mainGroupById: string | null): SprintView[] {
  return [
    {
      name: SPRINT_BOARD,
      kind: "board",
      groupById: mainGroupById ?? sprintId,
      filters: { rules: [{ propertyId: sprintId, op: "is", values: [CURRENT_KEY] }] },
    },
    {
      name: BACKLOG,
      kind: "list",
      groupById: null,
      filters: { rules: [{ propertyId: sprintId, op: "is", values: [NO_VALUE_KEY] }] },
    },
  ];
}
