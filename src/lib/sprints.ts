import { CURRENT_KEY } from "./filters";
import { sameOptionName } from "./option-name";
import { NO_VALUE_KEY, type ViewFilters, type ViewKind } from "./types";

/**
 * Sprints in one step.
 *
 * A scrum team needs one property, two views and two filters before it can
 * start. These are ordinary rows: nothing remembers that this made them, so a
 * team renames or deletes each one as it would any other. That is also why the
 * one question "are sprints set up?" is asked of the property's name and of
 * nothing else — there is no flag to go stale.
 */

export const SPRINT = "Sprint";
export const SPRINT_BOARD = "Sprint";
export const BACKLOG = "Backlog";

/** True once a property named Sprint exists, whoever made it and however. */
export function sprintsSetUp(properties: readonly { name: string }[]): boolean {
  return properties.some((p) => sameOptionName(p.name, SPRINT));
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
