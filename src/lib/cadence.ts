import { takenBy } from "./option-name";
import { SPRINT } from "./sprints";

/**
 * The cadence of an iteration: how long a sprint is. It fills in what nobody
 * typed when Ship makes the next sprint; it forbids
 * nothing, so an admin still makes, renames, dates and deletes a sprint by
 * hand, and the next one follows whatever is there.
 *
 * Everything here is pure. The routes read the options under the project
 * lock and ask this file what to make.
 */

export type Cadence = { length: number };

export const CADENCE_DEFAULT: Cadence = { length: 14 };
export const LENGTH_MAX = 365;
/** The longest option name, as the option routes take it. */
export const NAME_MAX = 40;

type Dates = { startAt: string | null; targetAt: string | null };
export type MadeSprint = { name: string; startAt: string; targetAt: string };

const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** The cadence a property's config holds, with the default for what is not there. */
export function readCadence(config: { cadence?: unknown } | null | undefined): Cadence {
  const saved = (config?.cadence ?? {}) as Partial<Record<keyof Cadence, unknown>>;
  return {
    length: whole(saved.length, 1, LENGTH_MAX) ? saved.length : CADENCE_DEFAULT.length,
  };
}

/** The fields of a request body a write would change, or the sentence a 400 says. */
export function readCadenceInput(input: {
  length?: unknown;
}): { patch: Partial<Cadence> } | { error: string } {
  const patch: Partial<Cadence> = {};
  if (input.length !== undefined) {
    if (!whole(input.length, 1, LENGTH_MAX)) {
      return { error: `The length must be a whole number of days from 1 to ${LENGTH_MAX}.` };
    }
    patch.length = input.length;
  }
  return { patch };
}

/** "Sprint 14" becomes "Sprint 15"; a name with no trailing number gets " 2". */
export function nextSprintName(name: string): string {
  const m = /^(.*?)(\d+)$/.exec(name.trim());
  const [stem, number] = m ? [m[1], String(Number(m[2]) + 1)] : [`${name.trim()} `, "2"];
  // An option name is at most 40 characters, so the stem gives way to the number.
  return `${stem.slice(0, Math.max(0, NAME_MAX - number.length))}${number}`;
}

/** A day plus some days. A day is a day, so it is counted in UTC. */
export function addDays(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * The dates of the sprint after `prev`: it starts the day after its target.
 * A sprint somebody left without a target is taken to have lasted one length,
 * and one with no dates at all hands over to today. It never starts before
 * today: a sprint ends when somebody ships it, and a late ship must not make
 * a sprint that has already ended and still reads as the current one.
 */
export function followOn(
  prev: Dates,
  length: number,
  today: string,
): { startAt: string; targetAt: string } {
  const after = prev.targetAt
    ? addDays(prev.targetAt, 1)
    : prev.startAt
      ? addDays(prev.startAt, length)
      : today;
  // Both are YYYY-MM-DD, so the later day is the larger string.
  const startAt = after > today ? after : today;
  return { startAt, targetAt: addDays(startAt, length - 1) };
}

/** What Use sprints makes: the first sprint, and the one after it to plan into. */
export function firstSprints(startAt: string, length: number): MadeSprint[] {
  const first = { name: `${SPRINT} 1`, startAt, targetAt: addDays(startAt, length - 1) };
  return [first, { name: nextSprintName(first.name), ...followOn(first, length, startAt) }];
}

/**
 * The sprint a ship of `shippingId` must make, or null when an open one
 * already follows it. It follows the last option there is, in the order
 * everybody shares, and takes the next name nobody holds yet. Only a ship
 * asks: nothing makes a sprint on a clock.
 */
export function sprintAfter(
  options: (Dates & { id: string; name: string; shippedAt: string | null })[],
  shippingId: string,
  cadence: Cadence,
  today: string,
): MadeSprint | null {
  const at = options.findIndex((o) => o.id === shippingId);
  if (at < 0 || options.slice(at + 1).some((o) => !o.shippedAt)) return null;
  const prev = options[options.length - 1];
  let name = nextSprintName(prev.name);
  while (takenBy(options, name)) name = nextSprintName(name);
  return { name, ...followOn(prev, cadence.length, today) };
}

/**
 * What a cadence box still owes: the new number, or null when it holds what
 * is saved or nothing a cadence can be. The blur and the leave ask this one
 * question, so they cannot disagree.
 */
export function cadenceEdit(draft: string, saved: number, max: number): number | null {
  const trimmed = draft.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= max && value !== saved ? value : null;
}
