/**
 * A day, and the windows of days a filter can name.
 *
 * Everything here is a `YYYY-MM-DD` string. Nothing reads a clock to decide
 * what a rule means, and nothing makes a `Date` out of a local time: the board
 * is drawn on the server and again in the browser, so a window worked out from
 * two clocks in two zones is two windows, and React throws the server's tree
 * away. The server says which day it is — once, in the project's zone — and
 * everything below is arithmetic on that one string.
 *
 * The written-out month names in `board.ts` exist for the same reason.
 */

/* ------------------------------------------------------------------ */
/* The words                                                           */
/* ------------------------------------------------------------------ */

/**
 * The windows a date rule may name, in the order the picker lists them. It is
 * a closed list: a word that is not here is not a question this board can
 * answer, and `readFilters` throws such a rule away exactly as it throws away
 * a rule naming an option somebody deleted.
 */
export const DATE_WINDOWS = [
  "today",
  "tomorrow",
  "this_week",
  "next_week",
  "last_7",
  "last_30",
  "next_7",
  "next_30",
  "overdue",
] as const;

export type DateWindow = (typeof DATE_WINDOWS)[number];

export function isDateWindow(word: unknown): word is DateWindow {
  return typeof word === "string" && (DATE_WINDOWS as readonly string[]).includes(word);
}

/** What the picker calls each window: the answer to "which days?". */
export const DATE_WINDOW_NAME: Record<DateWindow, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This week",
  next_week: "Next week",
  last_7: "The last 7 days",
  last_30: "The last 30 days",
  next_7: "The next 7 days",
  next_30: "The next 30 days",
  overdue: "Overdue",
};

/**
 * What a chip says after the property's name: "Due this week".
 *
 * "Overdue" is not here, because it already says what it is about: the chip
 * prints its name on its own, the way it says "Unassigned" rather than
 * "Assignee is Unassigned".
 */
export const DATE_WINDOW_SAID: Record<Exclude<DateWindow, "overdue">, string> = {
  today: "today",
  tomorrow: "tomorrow",
  this_week: "this week",
  next_week: "next week",
  last_7: "in the last 7 days",
  last_30: "in the last 30 days",
  next_7: "in the next 7 days",
  next_30: "in the next 30 days",
};

/* ------------------------------------------------------------------ */
/* Counting days                                                       */
/* ------------------------------------------------------------------ */

const MS_A_DAY = 86_400_000;

/**
 * A day as the number of days since the epoch, or null when it is not a day.
 *
 * `Date.UTC` rolls a month of 13 over into the next year instead of refusing
 * it, so the answer is written back out and compared: only a day that spells
 * itself the same way counts.
 */
function dayNumber(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  );
  if (Number.isNaN(at)) return null;
  const n = Math.round(at / MS_A_DAY);
  return dayString(n) === day ? n : null;
}

/** A day number back as YYYY-MM-DD. UTC throughout: nothing here has a zone. */
function dayString(n: number): string {
  const at = new Date(n * MS_A_DAY);
  const year = String(at.getUTCFullYear()).padStart(4, "0");
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The Monday of the week a day is in.
 *
 * The week starts on Monday, written out here and never asked of a locale: the
 * same day has to start the week on the server and in every browser, and a
 * locale answers Sunday in some places and Saturday in others. `getUTCDay` is
 * 0 for Sunday, 1 for Monday, up to 6 for Saturday — a number the language
 * fixes, not a setting anybody has.
 */
function mondayOf(n: number): number {
  const weekday = new Date(n * MS_A_DAY).getUTCDay();
  return n - ((weekday + 6) % 7);
}

/** The first and last day a window covers. Null is an open end. */
export type DayRange = { from: string | null; to: string | null };

/**
 * The days a window covers, worked out from the day the board was read on.
 *
 * Both ends are inclusive. "The last 7 days" are the seven days ending today
 * and "the next 7 days" the seven starting today, so today is in both: a
 * person asking what is due in the next week means starting now.
 *
 * **Overdue is before today, and nothing else.** No field on a task is
 * hardcoded, so the board cannot know what done means and does not guess. A
 * board that wants "late and not finished" says that with a second rule
 * beside this one.
 */
export function windowDays(word: DateWindow, today: string): DayRange | null {
  const at = dayNumber(today);
  if (at === null) return null;

  switch (word) {
    case "today":
      return { from: dayString(at), to: dayString(at) };
    case "tomorrow":
      return { from: dayString(at + 1), to: dayString(at + 1) };
    case "this_week": {
      const monday = mondayOf(at);
      return { from: dayString(monday), to: dayString(monday + 6) };
    }
    case "next_week": {
      const monday = mondayOf(at) + 7;
      return { from: dayString(monday), to: dayString(monday + 6) };
    }
    case "last_7":
      return { from: dayString(at - 6), to: dayString(at) };
    case "last_30":
      return { from: dayString(at - 29), to: dayString(at) };
    case "next_7":
      return { from: dayString(at), to: dayString(at + 6) };
    case "next_30":
      return { from: dayString(at), to: dayString(at + 29) };
    case "overdue":
      return { from: null, to: dayString(at - 1) };
  }
}

/* ------------------------------------------------------------------ */
/* The project's day                                                   */
/* ------------------------------------------------------------------ */

/** What a project's day is worked out in until somebody says otherwise. */
export const DEFAULT_TIME_ZONE = "UTC";

/**
 * True when this machine can work a day out in a zone of that name.
 *
 * The question is asked of the formatter, because the formatter is what
 * answers it later: whatever it accepts, `todayIn` can use. A list would be a
 * second opinion, and `Intl.supportedValuesOf("timeZone")` is the wrong one —
 * it is CLDR's canonical set, which keeps the **old** names and leaves out the
 * current ones. On this runtime it holds `Asia/Calcutta` and `Europe/Kiev` and
 * refuses `Asia/Kolkata` and `Europe/Kyiv`, along with `Etc/UTC`, `GMT`, `UTC`
 * itself and every lowercase spelling. An owner in India would have typed the
 * name their own computer shows them and been told it does not exist.
 *
 * The name is stored the way it was typed. The formatter reads a zone name
 * without case, so `europe/berlin` works and stays `europe/berlin` on the row:
 * rewriting somebody's spelling is a change nobody asked for, and nothing here
 * compares two zone names to each other.
 *
 * Only the server asks. A browser that refused a name the server would take is
 * a second answer to one question.
 */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone of a project, made safe to use.
 *
 * Read afresh and never cleaned up, exactly as a filter is: a name this
 * runtime does not know — an old zone a new ICU dropped, or a row written by
 * hand — falls back to UTC rather than throwing. A board that cannot say
 * which day it is draws nothing at all, and one wrong day is cheaper than no
 * board.
 */
export function readTimeZone(raw: unknown): string {
  return typeof raw === "string" && isTimeZone(raw) ? raw : DEFAULT_TIME_ZONE;
}

/** The one sentence a name nobody knows is refused with. */
export function zoneRefused(name: string): string {
  return `No time zone is called ${name}. Use a name like Europe/Berlin or UTC.`;
}

/**
 * The day it is in one zone, as YYYY-MM-DD.
 *
 * The parts are put together here rather than formatted, because a locale
 * decides the order and the separators — "21/09/2026" in one place and
 * "9/21/2026" in another — and the calendar is named as well, so a runtime
 * whose default is not Gregorian still answers the same day.
 *
 * This is the only place in the product that reads a clock for a filter, and
 * only the server calls it. The answer travels on the board as a string, so
 * the browser hydrates with the day the server drew and never reads its own.
 */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}
