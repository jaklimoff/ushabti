import { readCadence } from "./cadence";
import type { BoardData, PropertyOptionDTO, PropertyDTO } from "./types";

/** The four roles a property can play for the whole board, in the order the strip shows them. */
export type BoardRole = "types" | "done" | "releases" | "sprints";

export const ROLE_NAME: Record<BoardRole, string> = {
  types: "The types",
  done: "Done when",
  releases: "The releases",
  sprints: "The sprints",
};

/* What a board with the role off does instead, in one line. */
const ROLE_OFF: Record<BoardRole, string> = {
  types: "Every task shows every property.",
  done: "Only archived tasks are done.",
  releases: "No releases.",
  sprints: "No sprints.",
};

/** One done option is shown with its dot; past two, the rest are a count. */
const DONE_SHOWN = 2;

export type RoleTile = {
  role: BoardRole;
  name: string;
  /** The property that plays it, or null when the role is off. */
  property: PropertyDTO | null;
  /** "3 types" or "14 days", said after the name. Null when there is nothing to add. */
  detail: string | null;
  /** The done options drawn after "is", each with its colour. Only Done when has them. */
  done: PropertyOptionDTO[];
  /** How many done options are past the ones drawn. */
  more: number;
  /** What the board does with the role off. */
  off: string;
};

/**
 * Who plays each board role, read from the pointers the board already sends.
 * Those were read afresh on the server, so a pointer here names a property
 * that exists; one that cannot be found still reads as off rather than as
 * a name somebody guessed.
 */
export function boardRoles(data: Pick<BoardData, "project" | "properties">): RoleTile[] {
  const { project, properties } = data;
  const find = (id: string | null | undefined) =>
    (id && properties.find((p) => p.id === id)) || null;

  const types = find(project.typeBy);
  const doneBy = find(project.doneWhen?.propertyId);
  const releases = find(project.releaseBy);
  const sprints = find(project.sprintBy);

  const doneOptions = doneBy
    ? doneBy.options.filter((o) => project.doneWhen!.optionIds.includes(o.id))
    : [];
  const typeCount = types?.options.length ?? 0;
  const length = sprints ? readCadence(sprints.config).length : 0;

  const tile = (
    role: BoardRole,
    property: PropertyDTO | null,
    detail: string | null,
    done: PropertyOptionDTO[] = [],
  ): RoleTile => ({
    role,
    name: ROLE_NAME[role],
    property,
    detail: property ? detail : null,
    done: done.slice(0, DONE_SHOWN),
    more: Math.max(0, done.length - DONE_SHOWN),
    off: ROLE_OFF[role],
  });

  return [
    tile("types", types, `${typeCount} ${typeCount === 1 ? "type" : "types"}`),
    tile("done", doneBy, null, doneOptions),
    tile("releases", releases, null),
    tile("sprints", sprints, `${length} ${length === 1 ? "day" : "days"}`),
  ];
}

/** The roles one property plays, in the strip's order. */
export function rolesOf(
  property: PropertyDTO,
  data: Pick<BoardData, "project" | "properties">,
): BoardRole[] {
  return boardRoles(data)
    .filter((t) => t.property?.id === property.id)
    .map((t) => t.role);
}

/** The id a property row carries, so a tile can find it. */
export const propertyAnchor = (propertyId: string) => `prop-${propertyId}`;
