import { describe, expect, it } from "vitest";
import {
  circleSaid,
  isOver,
  brokenParts,
  parentRefusal,
  readDoneWhen,
  SELF_PARENT_SAID,
  wouldCircle,
  type LinkEdge,
} from "../links";
import type { PropertyDTO } from "../types";

const status: PropertyDTO = {
  id: "p-status",
  name: "Status",
  type: "select",
  position: "V",
  config: {},
  options: [
    {
      id: "o-todo",
      name: "Todo",
      color: "#9aa0aa",
      position: "V",
      startAt: null,
      targetAt: null,
      shippedAt: null,
      note: null,
    },
    {
      id: "o-done",
      name: "Done",
      color: "#4f8a5b",
      position: "k",
      startAt: null,
      targetAt: null,
      shippedAt: null,
      note: null,
    },
  ],
};

const assignee: PropertyDTO = {
  id: "p-who",
  name: "Assignee",
  type: "person",
  position: "W",
  config: {},
  options: [],
};

/* ------------------------------------------------------------------ */
/* What over means                                                     */
/* ------------------------------------------------------------------ */

describe("the project's word for done", () => {
  it("reads a property and one of its options", () => {
    expect(readDoneWhen({ propertyId: "p-status", optionId: "o-done" }, [status])).toEqual({
      propertyId: "p-status",
      optionId: "o-done",
    });
  });

  /* Nothing rewrites the project when the property goes, so the read is what
     throws the answer away — exactly as a filter's rule is. */
  it("falls back to archived when the property is gone", () => {
    expect(readDoneWhen({ propertyId: "p-status", optionId: "o-done" }, [])).toBe(null);
  });

  it("falls back to archived when the option is gone", () => {
    expect(readDoneWhen({ propertyId: "p-status", optionId: "o-shipped" }, [status])).toBe(null);
  });

  it("refuses a property that has no options to point at", () => {
    expect(readDoneWhen({ propertyId: "p-who", optionId: "u-1" }, [assignee])).toBe(null);
  });

  it("reads nothing out of nonsense", () => {
    expect(readDoneWhen(null, [status])).toBe(null);
    expect(readDoneWhen("Done", [status])).toBe(null);
    expect(readDoneWhen({ propertyId: 4, optionId: [] }, [status])).toBe(null);
  });
});

describe("a blocker that is over", () => {
  const done = { propertyId: "p-status", optionId: "o-done" };

  it("is over once it is archived, whatever the project says", () => {
    expect(isOver({ archivedAt: "2026-09-01T00:00:00.000Z", values: {} }, null)).toBe(true);
    expect(isOver({ archivedAt: "2026-09-01T00:00:00.000Z", values: {} }, done)).toBe(true);
  });

  it("is over when it holds the option the project named", () => {
    expect(isOver({ archivedAt: null, values: { "p-status": "o-done" } }, done)).toBe(true);
  });

  it("is not over while it holds another option", () => {
    expect(isOver({ archivedAt: null, values: { "p-status": "o-todo" } }, done)).toBe(false);
    expect(isOver({ archivedAt: null, values: {} }, done)).toBe(false);
  });

  /* The fallback: with no answer from the project, archived is the only word
     for over, and a live task is never over. */
  it("is not over on a live task when the project named nothing", () => {
    expect(isOver({ archivedAt: null, values: { "p-status": "o-done" } }, null)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Circles                                                             */
/* ------------------------------------------------------------------ */

describe("the circle check", () => {
  /** `a` blocks `b`, `b` blocks `c`. */
  const chain: LinkEdge[] = [
    { fromId: "a", toId: "b" },
    { fromId: "b", toId: "c" },
  ];

  it("refuses a task waiting on itself", () => {
    expect(wouldCircle([], "a", "a")).toBe(true);
  });

  it("lets a new link through", () => {
    expect(wouldCircle(chain, "c", "d")).toBe(false);
    expect(wouldCircle([], "a", "b")).toBe(false);
  });

  it("refuses the link that closes a pair", () => {
    expect(wouldCircle([{ fromId: "a", toId: "b" }], "b", "a")).toBe(true);
  });

  it("refuses the link that closes a longer chain", () => {
    expect(wouldCircle(chain, "c", "a")).toBe(true);
  });

  it("lets a second path through that closes nothing", () => {
    // `a` already blocks `c` the long way round. Saying so directly is fine.
    expect(wouldCircle(chain, "a", "c")).toBe(false);
  });

  it("holds when a link is already there twice over", () => {
    expect(wouldCircle([...chain, ...chain], "c", "a")).toBe(true);
  });

  it("ends on a circle that is already written", () => {
    const written: LinkEdge[] = [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "a" },
    ];
    expect(wouldCircle(written, "c", "a")).toBe(false);
  });

  it("says so in one sentence", () => {
    expect(circleSaid("USH-12", "USH-71")).toBe(
      "USH-12 already waits on USH-71, so this would be a circle.",
    );
  });
});

describe("one level of parts", () => {
  /* `fromId` is the parent, `toId` the child: epic owns a and b. */
  const parts: LinkEdge[] = [
    { fromId: "epic", toId: "a" },
    { fromId: "epic", toId: "b" },
  ];
  const keyOf = (id: string) => `K-${id}`;

  it("lets a task with no parts become part of a task with no parent", () => {
    expect(parentRefusal(parts, "epic", "c", keyOf)).toBeNull();
    expect(parentRefusal([], "x", "y", keyOf)).toBeNull();
  });

  it("lets a child move to another parent, which replaces the one it had", () => {
    expect(parentRefusal(parts, "other", "a", keyOf)).toBeNull();
  });

  it("refuses a task as its own parent", () => {
    expect(parentRefusal(parts, "c", "c", keyOf)).toBe(SELF_PARENT_SAID);
  });

  it("refuses a parent that is itself a part, which would be a second level", () => {
    expect(parentRefusal(parts, "a", "c", keyOf)).toBe(
      "K-a is part of K-epic, so it cannot have parts of its own.",
    );
  });

  it("refuses a parent for a task that has parts", () => {
    expect(parentRefusal(parts, "c", "epic", keyOf)).toBe(
      "K-epic has parts of its own, so it cannot be part of another task.",
    );
  });

  it("refuses a child as the parent of its own parent", () => {
    expect(parentRefusal(parts, "a", "epic", keyOf)).not.toBeNull();
  });
});

describe("a part put back", () => {
  it("leaves rows alone that still keep one level", () => {
    const edges: LinkEdge[] = [{ fromId: "epic", toId: "r" }];
    expect(brokenParts(edges, "r")).toEqual([]);
  });

  it("drops its parent when that parent became a part meanwhile", () => {
    const edges: LinkEdge[] = [
      { fromId: "p", toId: "r" },
      { fromId: "g", toId: "p" },
    ];
    expect(brokenParts(edges, "r")).toEqual([{ fromId: "p", toId: "r" }]);
  });

  it("drops a part that got parts of its own meanwhile", () => {
    const edges: LinkEdge[] = [
      { fromId: "r", toId: "c" },
      { fromId: "r", toId: "ok" },
      { fromId: "c", toId: "d" },
    ];
    expect(brokenParts(edges, "r")).toEqual([{ fromId: "r", toId: "c" }]);
  });

  it("drops the parent first, so its parts can stay", () => {
    const edges: LinkEdge[] = [
      { fromId: "p", toId: "r" },
      { fromId: "r", toId: "c" },
    ];
    expect(brokenParts(edges, "r")).toEqual([{ fromId: "p", toId: "r" }]);
  });
});
