import { takenBy } from "./option-name";
import { SPRINT } from "./sprints";

/**
 * The cadence of an iteration: how long a sprint is, and how many open ones
 * wait after the one that ships. It fills in what nobody typed; it forbids
 * nothing, so an admin still makes, renames, dates and deletes a sprint by
 * hand, and the next one follows whatever is there.
 *
 * Everything here is pure. The routes read the options under the project
 * lock and ask this file what to make.
 */

export type Cadence = { length: number; ahead: number };

export const CADENCE_DEFAULT: Cadence = { length: 14, ahead: 1 };
export const LENGTH_MAX = 365;
export const AHEAD_MAX = 10;
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
    ahead: whole(saved.ahead, 1, AHEAD_MAX) ? saved.ahead : CADENCE_DEFAULT.ahead,
  };
}

/**
 * The fields of a request body a write would change, or the sentence a 400
 * says. At least one ahead, always: that is what lets Ship move the rest on.
 */
export function readCadenceInput(input: {
  length?: unknown;
  ahead?: unknown;
}): { patch: Partial<Cadence> } | { error: string } {
  const patch: Partial<Cadence> = {};
  if (input.length !== undefined) {
    if (!whole(input.length, 1, LENGTH_MAX)) {
      return { error: `The length must be a whole number of days from 1 to ${LENGTH_MAX}.` };
    }
    patch.length = input.length;
  }
  if (input.ahead !== undefined) {
    if (!whole(input.ahead, 1, AHEAD_MAX)) {
      return { error: `Ahead must be a whole number from 1 to ${AHEAD_MAX}.` };
    }
    patch.ahead = input.ahead;
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
 * and one with no dates at all hands over to today.
 */
export function followOn(
  prev: Dates,
  length: number,
  today: string,
): { startAt: string; targetAt: string } {
  const startAt = prev.targetAt
    ? addDays(prev.targetAt, 1)
    : prev.startAt
      ? addDays(prev.startAt, length)
      : today;
  return { startAt, targetAt: addDays(startAt, length - 1) };
}

/** What Set up sprints makes: the first sprint, and `ahead` more after it. */
export function firstSprints(startAt: string, length: number, ahead: number): MadeSprint[] {
  const made: MadeSprint[] = [
    { name: `${SPRINT} 1`, startAt, targetAt: addDays(startAt, length - 1) },
  ];
  for (let i = 0; i < ahead; i++) {
    const prev = made[made.length - 1];
    made.push({ name: nextSprintName(prev.name), ...followOn(prev, length, startAt) });
  }
  return made;
}

/**
 * The sprints a ship of `shippingId` must make, so that `ahead` open ones
 * wait after it. Each follows the last option there is, in the order everybody
 * shares, and takes the next name nobody holds yet.
 */
export function sprintsAhead(
  options: (Dates & { id: string; name: string; shippedAt: string | null })[],
  shippingId: string,
  cadence: Cadence,
  today: string,
): MadeSprint[] {
  const at = options.findIndex((o) => o.id === shippingId);
  if (at < 0) return [];
  const open = options.slice(at + 1).filter((o) => !o.shippedAt).length;
  const made: MadeSprint[] = [];
  const taken: { name: string }[] = [...options];
  let prev: Dates & { name: string } = options[options.length - 1];
  for (let i = open; i < cadence.ahead; i++) {
    let name = nextSprintName(prev.name);
    while (takenBy(taken, name)) name = nextSprintName(name);
    const sprint = { name, ...followOn(prev, cadence.length, today) };
    made.push(sprint);
    taken.push(sprint);
    prev = sprint;
  }
  return made;
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
