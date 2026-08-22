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
