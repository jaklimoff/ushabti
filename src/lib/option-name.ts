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
