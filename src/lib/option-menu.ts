import type { PropertyOptionDTO } from "@/lib/types";

/**
 * What the menu of a select offers for what somebody typed.
 *
 * A new option is a column on a board grouped by it, and everybody sees it, so
 * it is made only from a row that says so. That row is offered only when no
 * option already carries the name: "high" beside High is a typo, not a wish.
 * `taken` is every name the property has, so a shipped sprint the menu does
 * not list still cannot be made a second time.
 * The exact match comes first, so Enter on it picks what was typed and not a
 * longer name that happens to sort earlier.
 */
export function optionMenu(
  options: PropertyOptionDTO[],
  draft: string,
  taken: PropertyOptionDTO[] = options,
): { matches: PropertyOptionDTO[]; add: string | null } {
  const name = draft.trim();
  const typed = name.toLowerCase();
  if (!typed) return { matches: options, add: null };

  const same = (o: PropertyOptionDTO) => o.name.trim().toLowerCase() === typed;
  const exact = options.filter(same);
  const partial = options.filter((o) => !same(o) && o.name.toLowerCase().includes(typed));
  return { matches: [...exact, ...partial], add: taken.some(same) ? null : name };
}

/**
 * Where the highlight sits when the menu opens, in a menu whose first row is
 * the empty one. It is the current option when there is one, because that is
 * the answer a sprint picker is asked for; otherwise the value the field holds.
 */
export function openingAt(
  options: PropertyOptionDTO[],
  value: string | null,
  current: string | null,
): number {
  return options.findIndex((o) => o.id === (current ?? value)) + 1;
}
