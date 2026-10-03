/**
 * The dates and the note an option of a select may carry. A Version, a Sprint
 * or a Quarter is an option with dates, so nothing on a task changes.
 *
 * A date is a day, never a moment: it is kept as `YYYY-MM-DD`, so it reads the
 * same in every time zone and on the server and in the browser alike.
 */
export type OptionDates = {
  startAt: string | null;
  targetAt: string | null;
  shippedAt: string | null;
  note: string | null;
};

export const NOTE_MAX = 2000;

/** True when a property says its options carry dates. Only a select can. */
export function carriesDates(property: {
  type: string;
  config: { dated?: boolean } | null;
}): boolean {
  return property.type === "select" && property.config?.dated === true;
}

const DATE_FIELDS = [
  ["startAt", "The start date"],
  ["targetAt", "The target date"],
  ["shippedAt", "The shipped date"],
] as const;

/** The day an ISO date or date-time names, or null when it names no real day. */
export function isoDay(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value.trim());
  if (!m) return null;
  if (value.trim().length > 10 && Number.isNaN(Date.parse(value))) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  // 2026-02-30 rolls over to March, which is how a day that does not exist shows.
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * The fields of a request body that a write would change. A field that is
 * absent is left alone; null clears it. The answer is the sentence a 400 says
 * when one cannot be read.
 */
export function readOptionDates(
  input: Record<string, unknown>,
): { patch: Partial<OptionDates> } | { error: string } {
  const patch: Partial<OptionDates> = {};
  for (const [key, label] of DATE_FIELDS) {
    const value = input[key];
    if (value === undefined) continue;
    if (value === null || value === "") {
      patch[key] = null;
      continue;
    }
    const day = typeof value === "string" ? isoDay(value) : null;
    if (!day) return { error: `${label} must be a date like 2026-10-03.` };
    patch[key] = day;
  }
  if (input.note !== undefined) {
    if (input.note !== null && typeof input.note !== "string") {
      return { error: "The note must be text." };
    }
    const note = (input.note ?? "").trim();
    if (note.length > NOTE_MAX) {
      return { error: `The note is too long (max ${NOTE_MAX} characters).` };
    }
    patch.note = note || null;
  }
  return { patch };
}

/**
 * Why the dates an option would end with cannot stand, or null. It reads the
 * whole option after the write, so a target moved alone is checked against the
 * start already saved.
 */
export function datesClash(dates: Pick<OptionDates, "startAt" | "targetAt">): string | null {
  const { startAt, targetAt } = dates;
  // Two `YYYY-MM-DD` strings order as their days do.
  if (startAt && targetAt && targetAt < startAt) {
    return "The target date cannot be before the start date.";
  }
  return null;
}

/** A multi-select option is a label, never a Version or a Sprint. */
export const ONLY_SELECT = "Only an option of a single select carries dates and a note.";

/** True when a body names any of the four, which only a select option carries. */
export function namesOptionDates(input: Record<string, unknown>): boolean {
  return ["startAt", "targetAt", "shippedAt", "note"].some((k) => input[k] !== undefined);
}

/**
 * What a date or note box still owes: the new value, null to clear it, or
 * undefined when it holds what is saved. Unlike a name, an empty box is an
 * answer here — it takes the date or the note away. The blur and the leave ask
 * this one question, so they cannot disagree.
 */
export function optionEdit(draft: string, saved: string | null): string | null | undefined {
  const trimmed = draft.trim();
  if (trimmed === (saved ?? "")) return undefined;
  return trimmed || null;
}
