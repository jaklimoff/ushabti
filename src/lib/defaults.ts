import type { PropertyType, ViewKind } from "./types";

export type DefaultOption = {
  name: string;
  color: string;
  /** Its column starts folded on a new project's boards: a parking column. */
  folded?: true;
};
export type DefaultProperty = {
  name: string;
  type: PropertyType;
  options?: DefaultOption[];
  /** Its last option is the project's Done when, so a new board can ship. */
  endsInDone?: true;
};

/**
 * A new project starts with the property set of the design. Nothing here is
 * hardcoded in the app: every row becomes an ordinary editable property, and
 * the user can rename, re-colour or delete any of it.
 */
export const DEFAULT_PROPERTIES: DefaultProperty[] = [
  {
    name: "Status",
    type: "select",
    endsInDone: true,
    options: [
      { name: "Later", color: "#4b5563", folded: true },
      { name: "Backlog", color: "#6b7280" },
      { name: "Todo", color: "#9aa0aa" },
      { name: "In Progress", color: "#d1913a" },
      { name: "Ready", color: "#3fb0c8" },
      { name: "Done", color: "#4f8a5b" },
    ],
  },
  {
    name: "Priority",
    type: "select",
    options: [
      { name: "Urgent", color: "#e0574d" },
      { name: "High", color: "#d1913a" },
      { name: "Medium", color: "#4b8fbe" },
      { name: "Low", color: "#8b8f98" },
    ],
  },
  { name: "Assignee", type: "person" },
  {
    name: "Estimate",
    type: "select",
    options: [
      { name: "XS", color: "#8b8f98" },
      { name: "S", color: "#4b8fbe" },
      { name: "M", color: "#3fb0c8" },
      { name: "L", color: "#d1913a" },
      { name: "XL", color: "#e0574d" },
    ],
  },
  {
    name: "Labels",
    type: "multi_select",
    options: [
      { name: "bug", color: "#e0574d" },
      { name: "feature", color: "#2f9e7a" },
      { name: "infra", color: "#4b8fbe" },
      { name: "ux", color: "#c2557a" },
      { name: "docs", color: "#7a8a2f" },
    ],
  },
  { name: "Due", type: "date" },
];

/**
 * Views that a new project starts with. `groupBy` names a default property; a
 * list groups nothing, so it names none.
 */
export const DEFAULT_VIEWS: {
  name: string;
  kind: ViewKind;
  groupBy: string | null;
  isDefault: boolean;
}[] = [
  { name: "Board", kind: "board", groupBy: "Status", isDefault: true },
  { name: "List", kind: "list", groupBy: null, isDefault: false },
];

export function suggestProjectKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "TSK";
  if (words.length === 1) return words[0].slice(0, 3).padEnd(2, "X");
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("");
}

/**
 * The config a default view starts with. A board starts with the parking
 * columns of its property folded, named by `folded` on the option and never
 * by its name. `optionIds` gives each default option's id by
 * "property:option".
 */
export function defaultViewConfig(
  view: (typeof DEFAULT_VIEWS)[number],
  optionIds: Map<string, string>,
): { startFolded?: string[] } {
  if (view.kind !== "board" || !view.groupBy) return {};
  const property = DEFAULT_PROPERTIES.find((p) => p.name === view.groupBy);
  const startFolded = (property?.options ?? [])
    .filter((o) => o.folded)
    .map((o) => optionIds.get(`${property!.name}:${o.name}`))
    .filter((id): id is string => id !== undefined);
  return startFolded.length ? { startFolded } : {};
}
