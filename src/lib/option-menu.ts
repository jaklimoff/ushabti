import type { PropertyOptionDTO } from "@/lib/types";

/**
 * What the menu of a select offers for what somebody typed.
 *
 * A new option is a column on a board grouped by it, and everybody sees it, so
 * it is made only from a row that says so. That row is offered only when no
 * option already carries the name: "high" beside High is a typo, not a wish.
 * The exact match comes first, so Enter on it picks what was typed and not a
 * longer name that happens to sort earlier.
 */
export function optionMenu(
  options: PropertyOptionDTO[],
  draft: string,
): { matches: PropertyOptionDTO[]; add: string | null } {
  const name = draft.trim();
  const typed = name.toLowerCase();
  if (!typed) return { matches: options, add: null };

  const same = (o: PropertyOptionDTO) => o.name.trim().toLowerCase() === typed;
  const exact = options.filter(same);
  const partial = options.filter((o) => !same(o) && o.name.toLowerCase().includes(typed));
  return { matches: [...exact, ...partial], add: exact.length ? null : name };
}
