import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Drizzle applies a migration only when its journal `when` is newer than the
 * newest one the database has applied. A branch rebased on top of a newer
 * migration keeps its older `when`, and production then skips it in silence,
 * while CI, which migrates an empty database, applies it. So the journal must
 * rise in `idx` order, and this says which entry to fix.
 */
type Entry = { idx: number; when: number; tag: string };

export function journalFaults(entries: Entry[]): string[] {
  const faults: string[] = [];
  const sorted = [...entries].sort((a, b) => a.idx - b.idx);
  for (let i = 1; i < sorted.length; i++) {
    const before = sorted[i - 1];
    const entry = sorted[i];
    if (entry.when <= before.when) {
      faults.push(
        `${entry.tag} has when ${entry.when}, not later than ${before.tag} (${before.when}). Production would skip it. Give it a when after ${before.when}.`,
      );
    }
  }
  return faults;
}

describe("drizzle/meta/_journal.json", () => {
  it("has a strictly rising when in idx order", () => {
    const journal: { entries: Entry[] } = JSON.parse(
      readFileSync(new URL("../../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
    );
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(journalFaults(journal.entries)).toEqual([]);
  });

  it("finds an entry whose when is not later than the one before", () => {
    const faults = journalFaults([
      { idx: 0, when: 100, tag: "0000_a" },
      { idx: 1, when: 300, tag: "0001_b" },
      { idx: 2, when: 200, tag: "0002_c" },
      { idx: 3, when: 200, tag: "0003_d" },
    ]);
    expect(faults).toHaveLength(2);
    expect(faults[0]).toContain("0002_c");
    expect(faults[1]).toContain("0003_d");
  });
});
