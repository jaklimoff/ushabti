import { describe, expect, it } from "vitest";
import { rankAfter, rankBefore, rankBetween, rankSequence } from "../rank";

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
