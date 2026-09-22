import { describe, expect, it } from "vitest";
import { rankAfter, rankBefore, rankBetween, rankSequence, rankSpread } from "../rank";

describe("fractional ranks", () => {
  it("appends after the last item", () => {
    let last: string | null = null;
    const list: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      last = rankAfter(last);
      list.push(last);
    }
    expect([...list].sort()).toEqual(list);
  });

  it("puts an item in front of the first", () => {
    let first = rankAfter(null);
    for (let i = 0; i < 200; i += 1) {
      const next = rankBefore(first);
      expect(next < first).toBe(true);
      first = next;
    }
  });

  it("always finds room between two neighbours", () => {
    let low = rankAfter(null);
    let high = rankAfter(low);
    for (let i = 0; i < 400; i += 1) {
      const mid = rankBetween(low, high);
      expect(low < mid).toBe(true);
      expect(mid < high).toBe(true);
      // squeeze from alternating sides so the strings really do get tight
      if (i % 2 === 0) low = mid;
      else high = mid;
    }
  });

  it("keeps a drag stable when the same move repeats", () => {
    const seq = rankSequence(5);
    expect([...seq].sort()).toEqual(seq);

    // move the last item to the very front, 100 times
    let list = [...seq];
    for (let i = 0; i < 100; i += 1) {
      const moved = rankBetween(null, list[0]);
      list = [moved, ...list.slice(0, -1)];
      expect([...list].sort()).toEqual(list);
    }
  });

  it("recovers when the bounds arrive the wrong way round", () => {
    const a = rankAfter(null);
    const b = rankAfter(a);
    const result = rankBetween(b, a);
    expect(result > b).toBe(true);
  });

  it("gives a mid point for an empty list", () => {
    const only = rankBetween(null, null);
    expect(only.length).toBeGreaterThan(0);
    expect(rankBefore(only) < only).toBe(true);
    expect(rankAfter(only) > only).toBe(true);
  });
});

describe("fractional ranks under stress", () => {
  it("survives ten thousand random moves and stays sorted", () => {
    let list = rankSequence(12);
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let step = 0; step < 10_000; step += 1) {
      const from = Math.floor(random() * list.length);
      const to = Math.floor(random() * (list.length + 1));
      const rest = list.filter((_, i) => i !== from);
      const moved = rankBetween(
        to > 0 ? rest[Math.min(to, rest.length) - 1] : null,
        to < rest.length ? rest[Math.min(to, rest.length)] : null,
      );
      rest.splice(Math.min(to, rest.length), 0, moved);
      list = rest;
      expect([...list].sort()).toEqual(list);
    }

    // no rank ever ends with the lowest digit, which is what keeps the search finite
    for (const rank of list) expect(rank.endsWith("0")).toBe(false);
    // and the strings stay short enough to store comfortably
    expect(Math.max(...list.map((r) => r.length))).toBeLessThan(60);
  });
});

/**
 * Many ranks at once.
 *
 * `rankAfter` called N times is not this, and an import of two thousand cards
 * is where the difference shows: each call halves what is left above it, the
 * strings grow a digit every few hundred items, and at about the 1,537th the
 * 256-step guard in `rankBetween` stops the answer increasing at all. So the
 * tests below ask for far more than an import may carry, and ask for strictly
 * increasing and short rather than merely sorted.
 */
describe("a spread of ranks", () => {
  const sizes = [1, 2, 61, 62, 63, 500, 2000, 5000];

  it.each(sizes)("gives %i ranks that strictly increase", (count) => {
    const list = rankSpread(null, count);
    expect(list).toHaveLength(count);
    expect(new Set(list).size).toBe(count);
    for (let i = 1; i < list.length; i += 1) expect(list[i - 1] < list[i]).toBe(true);
  });

  it.each(sizes)("keeps %i ranks short", (count) => {
    expect(Math.max(...rankSpread(null, count).map((r) => r.length))).toBeLessThan(20);
  });

  it("puts every rank after the neighbour it was given", () => {
    const first = rankSpread(null, 2000);
    const second = rankSpread(first.at(-1), 2000);
    expect(second[0] > first.at(-1)!).toBe(true);
    const all = [...first, ...second];
    for (let i = 1; i < all.length; i += 1) expect(all[i - 1] < all[i]).toBe(true);
  });

  it("never ends a rank with the lowest digit", () => {
    for (const rank of rankSpread(null, 5000)) expect(rank.endsWith("0")).toBe(false);
  });

  it("leaves room between any two of them afterwards", () => {
    const list = rankSpread(null, 2000);
    for (const at of [0, 1, 999, 1998]) {
      const mid = rankBetween(list[at], list[at + 1]);
      expect(list[at] < mid).toBe(true);
      expect(mid < list[at + 1]).toBe(true);
    }
  });

  it("follows a long rank left by an older board", () => {
    let last = rankAfter(null);
    for (let i = 0; i < 400; i += 1) last = rankBetween(last, rankAfter(last));
    const list = rankSpread(last, 300);
    expect(list[0] > last).toBe(true);
    for (let i = 1; i < list.length; i += 1) expect(list[i - 1] < list[i]).toBe(true);
  });

  it("asks for nothing and gets nothing", () => {
    expect(rankSpread(null, 0)).toEqual([]);
    expect(rankSpread("abc", -1)).toEqual([]);
  });
});
