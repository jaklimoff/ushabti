import type { PropertyType } from "./types";

export type DefaultOption = { name: string; color: string };
export type DefaultProperty = {
  name: string;
  type: PropertyType;
  showOnCard: boolean;
  options?: DefaultOption[];
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
    showOnCard: true,
    options: [
      { name: "Backlog", color: "#6b7280" },
      { name: "Todo", color: "#9aa0aa" },
      { name: "In Progress", color: "#d1913a" },
      { name: "Ready", color: "#3fb0c8" },
      { name: "Shipped", color: "#4f8a5b" },
    ],
  },
  {
    name: "Priority",
    type: "select",
    showOnCard: true,
    options: [
      { name: "Urgent", color: "#e0574d" },
      { name: "High", color: "#d1913a" },
      { name: "Medium", color: "#4b8fbe" },
      { name: "Low", color: "#8b8f98" },
    ],
  },
  { name: "Assignee", type: "person", showOnCard: true },
  {
    name: "Phase",
    type: "select",
    showOnCard: true,
    options: [
      { name: "PoC", color: "#8b8f98" },
      { name: "MVP", color: "#3fb0c8" },
      { name: "MMP", color: "#6d5bd0" },
      { name: "Pilot", color: "#d1913a" },
      { name: "GA", color: "#4f8a5b" },
    ],
  },
  {
    name: "Estimate",
    type: "select",
    showOnCard: true,
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
    showOnCard: true,
    options: [
      { name: "bug", color: "#e0574d" },
      { name: "feature", color: "#2f9e7a" },
      { name: "infra", color: "#4b8fbe" },
      { name: "ux", color: "#c2557a" },
      { name: "docs", color: "#7a8a2f" },
    ],
  },
  { name: "Due", type: "date", showOnCard: true },
];

/** Views that a new project starts with. Keyed by default property name. */
export const DEFAULT_VIEWS: { name: string; groupBy: string; isDefault: boolean }[] = [
  { name: "Board", groupBy: "Status", isDefault: true },
  { name: "Phases", groupBy: "Phase", isDefault: false },
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
