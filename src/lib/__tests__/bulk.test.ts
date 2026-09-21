import { describe, expect, it } from "vitest";
import { BULK_LIMIT, readTaskIds, rowsSaid, type BulkRow } from "../bulk";

const many = (count: number) => Array.from({ length: count }, (_, i) => `t-${i}`);

describe("readTaskIds", () => {
  it("takes a list of ids", () => {
    expect(readTaskIds(["a", "b"])).toEqual({ ok: true, ids: ["a", "b"] });
  });

  it("refuses anything that is not a list", () => {
    for (const raw of [undefined, null, "a", 7, { 0: "a" }]) {
      expect(readTaskIds(raw)).toEqual({ ok: false, said: "Name the tasks as a list of ids." });
    }
  });

  it("refuses a list with something other than an id in it", () => {
    expect(readTaskIds(["a", 7])).toEqual({
      ok: false,
      said: "Name the tasks as a list of ids.",
    });
  });

  it("refuses an empty list", () => {
    expect(readTaskIds([])).toEqual({ ok: false, said: "Name at least one task." });
    expect(readTaskIds([""])).toEqual({ ok: false, said: "Name at least one task." });
  });

  /* The same id twice is one task. Two rows about one task in one statement
     is what the upsert refuses outright, so they are joined before counting. */
  it("names each task once", () => {
    expect(readTaskIds(["a", "b", "a"])).toEqual({ ok: true, ids: ["a", "b"] });
  });

  it(`takes ${BULK_LIMIT} tasks and refuses one more`, () => {
    const full = readTaskIds(many(BULK_LIMIT));
    expect(full.ok).toBe(true);
    expect(full.ok && full.ids).toHaveLength(BULK_LIMIT);

    expect(readTaskIds(many(BULK_LIMIT + 1))).toEqual({
      ok: false,
      said: "That is more than 200 tasks. Set fewer at once.",
    });
  });

  /* The limit counts tasks, not ids, so a duplicate does not spend one. */
  it("counts after joining the duplicates", () => {
    expect(readTaskIds([...many(BULK_LIMIT), "t-0"]).ok).toBe(true);
  });
});

describe("rowsSaid", () => {
  const live = (id: string): BulkRow => ({ id, archivedAt: null });

  it("says nothing when every task is a live one of this board", () => {
    expect(rowsSaid(["a", "b"], [live("b"), live("a")])).toBeNull();
  });

  /* A task of another project is simply not among the rows the project's own
     query found, so one sentence answers both: what a token may not see, it
     may not name. */
  it("refuses a task that is not on this board", () => {
    expect(rowsSaid(["a", "b"], [live("a")])).toBe("One of those tasks is not on this board.");
  });

  /* No view draws an archived task, so it cannot be picked on a board. An id
     that names one came from somewhere else, and setting a property on a card
     nobody can see is a change with nothing to show for it. */
  it("refuses an archived task, and says the way round it", () => {
    const rows = [live("a"), { id: "b", archivedAt: new Date("2026-03-01T09:00:00.000Z") }];
    expect(rowsSaid(["a", "b"], rows)).toBe("One of those tasks is archived. Put it back first.");
  });

  /* The whole call goes or none of it does. Writing what it could reach would
     leave the board half set, and the answer would have to say which half. */
  it("refuses the whole call for one bad id", () => {
    expect(rowsSaid(["a", "b", "c"], [live("a"), live("c")])).not.toBeNull();
  });
});
