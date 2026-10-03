import { describe, expect, it } from "vitest";
import {
  keptOpenByUnship,
  movedWhenEnded,
  nextOpenOption,
  nextOptionOf,
  readShipRest,
  shipDay,
  shipQuestion,
  shipSaid,
  shipRestsFor,
  splitShip,
} from "../ship";

const done = { propertyId: "status", optionId: "done" };

describe("a ship splits the column by the done rule", () => {
  it("puts the done and the archived on one side and the rest on the other", () => {
    const split = splitShip(
      [
        { id: "a", archivedAt: null, values: { status: "done" } },
        { id: "b", archivedAt: null, values: { status: "doing" } },
        { id: "c", archivedAt: null, values: {} },
        { id: "d", archivedAt: "2026-10-01T00:00:00Z", values: {} },
      ],
      done,
    );
    expect(split).toEqual({ over: ["a", "d"], rest: ["b", "c"] });
  });

  it("with no done rule, nothing on the board is over", () => {
    const split = splitShip([{ id: "a", archivedAt: null, values: { status: "done" } }], null);
    expect(split).toEqual({ over: [], rest: ["a"] });
  });
});

describe("the next option", () => {
  const options = [{ id: "v1" }, { id: "v2" }, { id: "v3" }];

  it("is the one after it by position", () => {
    expect(nextOptionOf(options, "v1")?.id).toBe("v2");
  });

  it("is none for the last option, so Move is not offered", () => {
    expect(nextOptionOf(options, "v3")).toBeNull();
    expect(shipRestsFor(false)).toEqual(["leave", "clear"]);
    expect(shipRestsFor(true)).toEqual(["next", "leave", "clear"]);
  });
});

describe("the next open option", () => {
  const options = [
    { id: "s1", shippedAt: null },
    { id: "s2", shippedAt: "2026-09-01" },
    { id: "s3", shippedAt: null },
  ];

  it("steps over a shipped sprint, which has no column to move into", () => {
    expect(nextOpenOption({ type: "iteration" }, options, "s1")?.id).toBe("s3");
    expect(nextOpenOption({ type: "iteration" }, options, "s3")).toBeNull();
  });

  it("keeps the next version of a dated select, shipped or not", () => {
    expect(nextOpenOption({ type: "select" }, options, "s1")?.id).toBe("s2");
  });
});

describe("the body of a ship", () => {
  it("takes the three answers and nothing else", () => {
    expect(readShipRest({ rest: "next" })).toEqual({ rest: "next" });
    expect(readShipRest({ rest: "leave" })).toEqual({ rest: "leave" });
    expect(readShipRest({ rest: "clear" })).toEqual({ rest: "clear" });
    expect(readShipRest({ rest: "archive" })).toHaveProperty("error");
    expect(readShipRest({})).toHaveProperty("error");
  });
});

describe("the question", () => {
  it("names both numbers", () => {
    expect(shipQuestion("v1", 3, 2)).toBe(
      "Ship v1? 3 tasks are over and will be archived. 2 tasks are not over.",
    );
  });

  it("says one task, and leaves out a rest of none", () => {
    expect(shipQuestion("v1", 1, 1)).toBe(
      "Ship v1? 1 task is over and will be archived. 1 task is not over.",
    );
    expect(shipQuestion("v1", 0, 0)).toBe("Ship v1? 0 tasks are over and will be archived.");
  });
});

describe("the day a ship writes", () => {
  it("is a day, never a moment", () => {
    expect(shipDay(new Date("2026-10-03T23:30:00Z"))).toBe("2026-10-03");
  });
});

describe("what the board says after", () => {
  it("names what went where, in the server's numbers", () => {
    const done = { archived: 3, moved: 2, shippedAt: "2026-10-03" };
    expect(shipSaid("v1", { ...done, rest: "next" }, "v2")).toBe(
      "Shipped v1: archived 3 tasks, moved 2 tasks to v2.",
    );
    expect(shipSaid("v1", { ...done, rest: "clear" }, "v2")).toBe(
      "Shipped v1: archived 3 tasks, cleared 2 tasks.",
    );
    expect(shipSaid("v1", { ...done, archived: 1, moved: 0, rest: "leave" }, null)).toBe(
      "Shipped v1: archived 1 task.",
    );
  });
});

describe("the comment a roll leaves", () => {
  it("names both sprints and why, in plain words", () => {
    expect(movedWhenEnded("Sprint 14", "Sprint 15")).toBe(
      "Moved from Sprint 14 to Sprint 15 when Sprint 14 ended.",
    );
  });
});

describe("an unship", () => {
  it("keeps a sprint open only when its end has passed", () => {
    expect(keptOpenByUnship("2026-10-02", "2026-10-03")).toBe(true);
  });

  it("leaves a sprint that has not ended free to roll when it does", () => {
    expect(keptOpenByUnship("2026-10-03", "2026-10-03")).toBe(false);
    expect(keptOpenByUnship("2026-10-10", "2026-10-03")).toBe(false);
    expect(keptOpenByUnship(null, "2026-10-03")).toBe(false);
  });
});
