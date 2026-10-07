import { carriesDates } from "./option-dates";

/**
 * Releases in one step.
 *
 * A release is an option of one dated select; there is no milestone table.
 * `projects.releaseBy` is the Use releases switch and says which select it
 * is. Use releases makes a select named Release and a Roadmap grouped by it,
 * and both are ordinary rows afterwards.
 */

export const RELEASE = "Release";
export const ROADMAP = "Roadmap";

type Named = { id: string; type: string; config: { dated?: boolean } | null };

/**
 * The select this project ships releases by, made safe to use. Read afresh
 * and never cleaned up, as `typeBy` is: a pointer at a property that is gone,
 * or is no longer a select, reads as releases off.
 */
export function readReleaseBy(raw: unknown, properties: readonly Named[]): string | null {
  if (typeof raw !== "string") return null;
  return properties.some((p) => p.id === raw && p.type === "select") ? raw : null;
}

/**
 * The select Use releases takes rather than make one: the one the pointer
 * names, or else the first select whose options carry dates. An iteration
 * carries dates too, and is the sprints' property, never a release's. Off clears the
 * pointer and keeps the property, so on again finds it here.
 */
export function releaseToReuse(raw: unknown, properties: readonly Named[]): string | null {
  return (
    readReleaseBy(raw, properties) ??
    properties.find((p) => p.type === "select" && carriesDates(p))?.id ??
    null
  );
}
