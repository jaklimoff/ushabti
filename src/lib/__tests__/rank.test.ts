import { describe, expect, it } from "vitest";
import {
  RANK_CAP,
  rankAfter,
  rankBefore,
  rankBetween,
  rankSequence,
  rankSpread,
  rebalanceTail,
  spreadLength,
  type Rebalance,
} from "../rank";

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

/**
 * The end of a list, played the way the create and the move route play it.
 *
 * Both hold the project lock, both hold every rank in order, and both ask for
 * the rank on the end through this one rule. The tests below are the routes
 * with the database taken out.
 */
function appendTo(list: string[]): string[] {
  const plan = rebalanceTail(list);
  if (!plan) return [...list, rankAfter(list.at(-1) ?? null)];
  return [...list.slice(0, plan.from), ...plan.ranks, plan.next];
}

describe("a list that only ever grows at the end", () => {
  it("keeps ten thousand appends increasing and short", () => {
    let list: string[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      list = appendTo(list);
      expect(list).toHaveLength(i + 1);
    }

    for (let i = 1; i < list.length; i += 1) expect(list[i - 1] < list[i]).toBe(true);
    expect(new Set(list).size).toBe(list.length);
    expect(Math.max(...list.map((r) => r.length))).toBeLessThan(RANK_CAP);
    for (const rank of list) expect(rank.endsWith("0")).toBe(false);
  });

  it("leaves a middle between any two neighbours afterwards", () => {
    let list: string[] = [];
    for (let i = 0; i < 2_000; i += 1) list = appendTo(list);

    for (let i = 1; i < list.length; i += 1) {
      const mid = rankBetween(list[i - 1], list[i]);
      expect(list[i - 1] < mid).toBe(true);
      expect(mid < list[i]).toBe(true);
    }
  });

  it("rewrites only the end of the list, and shortens what it rewrites", () => {
    /* Walk past the 256 rows a rewrite reaches for, so there is a front for it
       to leave alone, then walk on to the next rewrite and see what it did. */
    let list: string[] = [];
    while (list.length <= 300) list = appendTo(list);
    let plan = rebalanceTail(list);
    while (!plan) {
      list = appendTo(list);
      plan = rebalanceTail(list);
    }

    expect(plan.from).toBeGreaterThan(0);
    expect(plan.ranks).toHaveLength(list.length - plan.from);
    const wasLongest = Math.max(...list.slice(plan.from).map((r) => r.length));
    expect(wasLongest).toBeGreaterThan(RANK_CAP / 2);

    const after = appendTo(list);
    // Everything before the reach is untouched, so nothing moves on screen.
    expect(after.slice(0, plan.from)).toEqual(list.slice(0, plan.from));
    // And what was rewritten is short again.
    expect(Math.max(...after.slice(plan.from).map((r) => r.length)) * 2).toBeLessThanOrEqual(
      RANK_CAP,
    );
    for (let i = 1; i < after.length; i += 1) expect(after[i - 1] < after[i]).toBe(true);
  });

  it("asks for no rewrite while the ranks are short", () => {
    expect(rebalanceTail([])).toBeNull();
    expect(rebalanceTail(rankSequence(50))).toBeNull();
    expect(rebalanceTail(rankSpread(null, 5_000))).toBeNull();
  });
});

describe("a rank left long by an older board", () => {
  /* What the reviewer of #77 seeded by hand: past the old 256-step guard,
     where the search used to stop and answer below the rank it was given. */
  const seeded = "z".repeat(256) + "V";

  it("still goes up from a rank of 257 characters", () => {
    expect(seeded).toHaveLength(257);
    const next = rankAfter(seeded);
    expect(next > seeded).toBe(true);
    const third = rankAfter(next);
    expect(third > next).toBe(true);
  });

  it("still finds a middle under a rank of 257 characters", () => {
    const mid = rankBetween("V", seeded);
    expect("V" < mid).toBe(true);
    expect(mid < seeded).toBe(true);
  });

  it("shortens a whole list that ran away, and keeps its order", () => {
    /* Every rank long, so 256 rows are not enough and the reach has to widen
       until it reaches the front. */
    const runaway: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 1_200; i += 1) {
      last = rankAfter(last);
      runaway.push(last);
    }
    expect(Math.max(...runaway.map((r) => r.length))).toBeGreaterThan(RANK_CAP);

    const plan = rebalanceTail(runaway);
    expect(plan).not.toBeNull();
    const fixed = [...runaway.slice(0, plan!.from), ...plan!.ranks, plan!.next];

    expect(fixed).toHaveLength(runaway.length + 1);
    expect(new Set(fixed).size).toBe(fixed.length);
    for (let i = 1; i < fixed.length; i += 1) expect(fixed[i - 1] < fixed[i]).toBe(true);
    expect(Math.max(...fixed.map((r) => r.length))).toBeLessThan(RANK_CAP);
    for (const rank of fixed) expect(rank.endsWith("0")).toBe(false);
  });

  it("goes on appending after the seeded rank without stalling", () => {
    /* The seeded rank is the whole runaway tail here, so the first append
       rewrites it as well, and the list is short from then on. */
    let list = [seeded];
    for (let i = 0; i < 500; i += 1) list = appendTo(list);
    expect(list).toHaveLength(501);
    expect(new Set(list).size).toBe(501);
    for (let i = 1; i < list.length; i += 1) expect(list[i - 1] < list[i]).toBe(true);
    expect(Math.max(...list.map((r) => r.length))).toBeLessThan(RANK_CAP);
  });
});

/**
 * What a rewrite costs to plan.
 *
 * `rebalanceTail` tries one reach after another and keeps the first that is
 * short enough. It used to build every reach in full to measure it and throw
 * the rest away, which on a board whose whole order ran away is most of the
 * work: 3.4 s of planning for 40,000 rows, all of it under the project lock.
 * It now asks `spreadLength` instead and builds once.
 *
 * The plan itself did not change, so the old rule stays here as the answer to
 * check the new one against.
 */
function oldRebalanceTail(positions: string[]): Rebalance | null {
  const next = rankAfter(positions.at(-1) ?? null);
  if (next.length < RANK_CAP) return null;

  // 256 is `TAIL`, which the module keeps to itself.
  for (let take = Math.max(1, Math.min(256, positions.length)); ; take *= 2) {
    const from = Math.max(0, positions.length - take);
    const anchor = from > 0 ? positions[from - 1] : null;
    const fresh = rankSpread(anchor, positions.length - from + 1);
    const longest = fresh.reduce((most, r) => Math.max(most, r.length), 0);
    if (longest * 2 <= RANK_CAP || from === 0) {
      return { from, ranks: fresh.slice(0, -1), next: fresh[fresh.length - 1] };
    }
  }
}

/**
 * A board whose end has run out of room, in one of its two shapes.
 *
 * One ran away from its first task, so every rank in it is long and the reach
 * has to widen. One has a short body — an import, or an earlier mend — with a
 * long end grown on top of it, which the first reach can mend on its own.
 */
function randomTail(random: () => number): string[] {
  const list: string[] = [];
  let last: string | null = null;

  if (random() > 0.4) {
    list.push(...rankSpread(null, 100 + Math.floor(random() * 700)));
    last = list.at(-1)!;
  }
  const rows = 200 + Math.floor(random() * 500);
  for (let i = 0; i < rows; i += 1) {
    last = rankAfter(last);
    list.push(last);
  }
  // And on until the end really has run out of room, so there is a plan to read.
  while (rankAfter(last).length < RANK_CAP) {
    last = rankAfter(last);
    list.push(last);
  }
  return list;
}

describe("how long a spread would be", () => {
  const anchors = ["", "0", "z", "V", "V0", "0z", "z0", "zzzzzzzzzz", "0000000001", "abc"];
  const counts = [1, 2, 3, 61, 62, 63, 500, 3843, 3844, 3845];

  it("says what building the spread says", () => {
    for (const anchor of anchors) {
      for (const count of counts) {
        const built = Math.max(...rankSpread(anchor || null, count).map((r) => r.length));
        expect(spreadLength(anchor || null, count), `${anchor || "nothing"} × ${count}`).toBe(
          built,
        );
      }
    }
  });

  it("says the same of a long rank left by an older board", () => {
    let last = rankAfter(null);
    for (let i = 0; i < 400; i += 1) last = rankBetween(last, rankAfter(last));
    for (const count of [1, 2, 300, 5_000]) {
      const built = Math.max(...rankSpread(last, count).map((r) => r.length));
      expect(spreadLength(last, count)).toBe(built);
    }
  });

  it("asks for nothing and gets nothing", () => {
    expect(spreadLength(null, 0)).toBe(0);
    expect(spreadLength("abc", -1)).toBe(0);
  });
});

/** One counter written out in six digits, so a wall of `z` above sorts by it. */
function counterKey(n: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let out = "";
  let left = n;
  for (let i = 0; i < 6; i += 1) {
    out = alphabet[left % 62] + out;
    left = Math.floor(left / 62);
  }
  return out;
}

describe("planning a rewrite", () => {
  it("plans what building every reach planned, on twenty random tails", () => {
    let seed = 20_250_922;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let t = 0; t < 20; t += 1) {
      const positions = randomTail(random);
      const plan = rebalanceTail(positions);
      expect(plan, `tail ${t} of ${positions.length} rows`).not.toBeNull();
      expect(plan).toEqual(oldRebalanceTail(positions));
    }
  });

  it("plans a runaway board of forty thousand rows without building it", () => {
    /* Every rank long and all of them increasing, which is what an old board
       looks like after its order ran away. Building every reach to measure it
       took 3.4 s here; the bound is loose because a busy machine is slow, and
       it is still a long way under what this used to cost. */
    const wall = "z".repeat(250);
    const positions = Array.from({ length: 40_000 }, (_, i) => wall + counterKey(i + 1));

    const started = performance.now();
    const plan = rebalanceTail(positions);
    const spent = performance.now() - started;

    expect(plan).not.toBeNull();
    expect(plan!.from).toBe(0);
    expect(plan!.ranks).toHaveLength(40_000);
    expect(Math.max(...plan!.ranks.map((r) => r.length))).toBeLessThan(RANK_CAP / 2);
    expect(spent).toBeLessThan(500);
  });
});
