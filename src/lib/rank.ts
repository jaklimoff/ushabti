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

  for (let guard = 0; guard < 256; guard += 1) {
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
 * it, so the ranks grow one digit every few hundred items and the search in
 * `rankBetween` hits its 256-step guard at about the 1,537th: from there on
 * the answer stops increasing, and the rest of the list arrives in no order at
 * all. An import of two thousand cards is exactly that shape, so it asks for
 * its ranks once.
 *
 * The room above `after` is divided into `count + 1` equal steps and the ranks
 * sit on the marks, so they are evenly spread, strictly increasing and all the
 * same short length. `width` grows until one step is at least one unit wide,
 * which is what makes the length bounded rather than hoped for.
 */
export function rankSpread(after: string | null | undefined, count: number): string[] {
  if (count <= 0) return [];
  const lower = after && after.length > 0 ? after : "";

  /* One digit more than the neighbour, so there is somewhere above it to put
     anything at all, and then as many as `count` marks need. */
  for (let width = Math.max(lower.length, 1) + 1; ; width += 1) {
    const top = BigInt(BASE) ** BigInt(width);
    const floor = toNumber(lower, width);
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
