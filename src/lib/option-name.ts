/**
 * Two option names are the same name when they differ only in letter case or
 * in the spaces around them. The menu reads a name the same way, so "high"
 * beside High is refused here for the same reason it is not offered there.
 */
export function sameOptionName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The option that already carries `name`, or null. The caller reads `siblings`
 * under the project lock, without the option being renamed, so two writes at
 * once cannot both pass.
 */
export function takenBy<O extends { name: string }>(siblings: O[], name: string): O | null {
  return siblings.find((o) => sameOptionName(o.name, name)) ?? null;
}

/** What a refused name says. It names the option that holds it, as it is spelt. */
export function takenSaid(property: string, taken: string): string {
  return `${property} already has an option named ${taken}.`;
}

/** How many options a new property may be made with. */
export const OPTIONS_MAX = 40;

/**
 * What a list that is too long says. The box says it before it sends and the
 * route says it again, so a list is refused whole and never cut short.
 */
export function tooManySaid(count: number): string {
  return `A property holds at most ${OPTIONS_MAX} options. This list has ${count}.`;
}

/** The names a box of one option per line holds. A name may carry a comma. */
export function optionLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
