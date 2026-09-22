/**
 * Fractional indexing.
 *
 * A rank is a string of digits from ALPHABET, read as the fraction
 * 0.d1d2d3... in base 62. To put an item between two neighbours we build a
 * string that sorts between them, so one drag writes one row instead of
 * renumbering the whole column.
 *
 * Every rank this module produces ends with a digit above the lowest one.
 * That rule is what keeps the search below finite.
 *
 * A rank appended to the end of a list is longer than the one before it every
 * sixth time, because each call halves what room is left above the last rank.
 * Nothing can stop that: the end of a list only ever climbs. So the length is
 * capped instead, and `rebalanceTail` says how to spend one write putting the
 * end of the list back down where there is room. See `RANK_CAP`.
 */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = ALPHABET.length;

function digit(ch: string): number {
  const i = ALPHABET.indexOf(ch);
  return i < 0 ? 0 : i;
}

/** A rank that sorts strictly between `a` and `b`. Either bound may be open. */
export function rankBetween(a: string | null | undefined, b: string | null | undefined): string {
  const lower = a && a.length > 0 ? a : "";
  const upper = b && b.length > 0 ? b : "";

  // Bad input. Treat it as "put this at the end".
  if (lower && upper && lower >= upper) return rankBetween(lower, null);

  let prefix = "";
  let i = 0;
  // True once the digits so far are already below the upper bound, which lets
  // the rest of the string run all the way up to the top of the alphabet.
  let upperOpen = upper === "";

  /* The search needs one place per digit of the longer bound, and one more to
     open a new place below them both. A fixed count was wrong: a rank longer
     than it stopped the search early, and the truncated answer sorted *below*
     the lower bound, so a list that reached that length stopped ordering. The
     two spare places are for a stored rank that breaks the rule above and ends
     in the lowest digit; the search cannot answer that one, and this is what
     keeps it from running for ever. */
  const limit = Math.max(lower.length, upper.length) + 2;

  for (let guard = 0; guard < limit; guard += 1) {
    const lo = i < lower.length ? digit(lower[i]) : 0;
    const hi = upperOpen ? BASE : i < upper.length ? digit(upper[i]) : 0;

    if (hi - lo > 1) {
      return prefix + ALPHABET[lo + Math.floor((hi - lo) / 2)];
    }

    // The bounds share this digit, or sit next to each other. Keep the lower
    // digit and look one place deeper.
    prefix += ALPHABET[lo];
    if (!upperOpen && hi === lo + 1) upperOpen = true;
    i += 1;
  }

  return prefix + ALPHABET[Math.floor(BASE / 2)];
}

/** Rank for an item appended to the end of a list. */
export function rankAfter(last: string | null | undefined): string {
  return rankBetween(last, null);
}

/** Rank for an item put in front of a list. */
export function rankBefore(first: string | null | undefined): string {
  return rankBetween(null, first);
}

/** N ranks in ascending order, used when a project is seeded. */
export function rankSequence(count: number): string[] {
  const out: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < count; i += 1) {
    prev = rankAfter(prev);
    out.push(prev);
  }
  return out;
}

/**
 * N ranks after one neighbour, worked out in one go.
 *
 * `rankAfter` called N times is not this. Each call halves what is left above
 * it, so the ranks grow a digit every sixth item and two thousand of them end
 * a third of a kilobyte long, which `rebalanceTail` then has to undo. An
 * import of two thousand cards is exactly that shape, so it asks for its ranks
 * once.
 *
 * The room above `after` is divided into `count + 1` equal steps and the ranks
 * sit on the marks, so they are evenly spread, strictly increasing and all the
 * same short length. `width` grows until one step is at least one unit wide,
 * which is what makes the length bounded rather than hoped for.
 */
export function rankSpread(after: string | null | undefined, count: number): string[] {
  if (count <= 0) return [];
  const lower = after && after.length > 0 ? after : "";

  /* As many digits as `count` marks need, and no more. Reading the neighbour
     at a width shorter than itself rounds it down, so the marks start one unit
     above that rounding: the first one then clears the neighbour whatever its
     own length is. Starting at the neighbour's length instead would write
     ranks a digit longer than the one they sit above, every time, and a tail
     rewritten again and again would creep a digit longer each round. */
  for (let width = 1; ; width += 1) {
    const top = BigInt(BASE) ** BigInt(width);
    const floor = lower === "" ? 0n : toNumber(lower, width) + 1n;
    if (floor >= top) continue;
    const step = (top - floor) / BigInt(count + 1);
    if (step < 1n) continue;

    const out: string[] = [];
    for (let i = 1; i <= count; i += 1) out.push(toRank(floor + step * BigInt(i), width));
    return out;
  }
}

/** A rank read as a whole number of `width` digits: "a" at width 3 is "a00". */
function toNumber(rank: string, width: number): bigint {
  let value = 0n;
  for (let i = 0; i < width; i += 1) {
    value = value * BigInt(BASE) + BigInt(i < rank.length ? digit(rank[i]) : 0);
  }
  return value;
}

/**
 * The digits of one whole number, with the trailing zeros taken off again.
 *
 * A rank may not end in the lowest digit: `rankBetween` reads a rank as the
 * fraction 0.d1d2…, so "10" and "1" are the same number, and a rank ending in
 * a zero leaves that function looking for a gap that is not there. Cutting
 * them off keeps the order, because two ranks with no trailing zeros sort by
 * their digits exactly as their fractions do.
 */
function toRank(value: bigint, width: number): string {
  const digits: string[] = [];
  let left = value;
  const base = BigInt(BASE);
  for (let i = 0; i < width; i += 1) {
    digits.unshift(ALPHABET[Number(left % base)]);
    left /= base;
  }
  let end = digits.length;
  while (end > 1 && digits[end - 1] === ALPHABET[0]) end -= 1;
  return digits.slice(0, end).join("");
}

/**
 * A rank made on the append path stays shorter than this; a task dropped
 * between two others can still grow past it, and only the order is promised
 * there.
 *
 * 32 keeps `tasks_project_position_idx` narrow, and it is loose enough that a
 * rewrite is rare: a rank grows a digit every sixth append, so about 150 tasks
 * go on the end of a board between one rewrite and the next.
 */
export const RANK_CAP = 32;

/** How far back a rewrite reaches first. See `rebalanceTail`. */
const TAIL = 256;

export type Rebalance = {
  /** The first index of `positions` the rewrite replaces. */
  from: number;
  /** The ranks that replace `positions` from `from` on, in that order. */
  ranks: string[];
  /** The rank for the task going on the end. */
  next: string;
};

/**
 * How to put the end of a list back where there is room, or null while there
 * is room already.
 *
 * `positions` is every rank in the project, in order. The answer replaces the
 * last few of them with one spread. It moves nothing visible, because the
 * order is kept, and it costs one write, because it is one statement.
 *
 * Only the end of a list can be mended this way. `rankSpread` fills the open
 * room above one neighbour, and the end of the list is the only place where
 * that room belongs to nobody else.
 *
 * The first reach is 256 rows, and the number matters. About 150 tasks fit on
 * the end of a board between one rewrite and the next, so a shorter reach
 * would anchor on one of the long ranks it is meant to be rid of, shorten
 * nothing, and have the next task ask for another rewrite. When 256 rows are
 * not enough — an old board whose whole order ran away — the reach doubles
 * until they are. The last stop is the whole project, which is always short,
 * because a spread of a million ranks is four digits.
 */
export function rebalanceTail(positions: string[]): Rebalance | null {
  const next = rankAfter(positions.at(-1) ?? null);
  if (next.length < RANK_CAP) return null;

  for (let take = Math.max(1, Math.min(TAIL, positions.length)); ; take *= 2) {
    const from = Math.max(0, positions.length - take);
    const anchor = from > 0 ? positions[from - 1] : null;
    /* One more than the rows, because the task being added takes the top mark. */
    const fresh = rankSpread(anchor, positions.length - from + 1);
    // Counted and not spread: this list can be a whole project.
    const longest = fresh.reduce((most, r) => Math.max(most, r.length), 0);
    // Half the cap, so the rewrite buys at least another hundred tasks.
    if (longest * 2 <= RANK_CAP || from === 0) {
      return { from, ranks: fresh.slice(0, -1), next: fresh[fresh.length - 1] };
    }
  }
}
