import { describe, expect, it } from "vitest";
import { hitNote, searchCounted, searchTasks } from "../search";
import type { TaskDTO } from "../types";

const WHEN = "2026-02-01T00:00:00.000Z";

function task(over: Partial<TaskDTO> & { number: number }): TaskDTO {
  return {
    id: `t-${over.number}`,
    key: `DP-${over.number}`,
    title: "",
    description: "",
    position: String(over.number).padStart(3, "0"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    values: {},
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    blockedBy: [],
    parts: null,
    ...over,
  };
}

const TASKS: TaskDTO[] = [
  task({ number: 1, title: "Log in with a passkey" }),
  task({ number: 4, title: "Rate limit the sign-in route" }),
  task({
    number: 14,
    title: "Write the login guide",
    description: "Screenshots of the log in box.",
  }),
  task({ number: 40, title: "Ship the release image" }),
];

function keys(query: string, tasks = TASKS): string[] {
  return searchTasks(tasks, query).map((hit) => hit.task.key);
}

describe("searchTasks", () => {
  it("finds nothing until there is something to find", () => {
    expect(searchTasks(TASKS, "")).toEqual([]);
    expect(searchTasks(TASKS, "   ")).toEqual([]);
  });

  it("answers a key, whatever case it is typed in", () => {
    expect(keys("dp-4")[0]).toBe("DP-4");
    expect(keys("DP-4")[0]).toBe("DP-4");
  });

  it("puts the task a bare number names above the keys that merely start that way", () => {
    // "4" is in DP-4, DP-14 and DP-40. Only one of them is task 4.
    expect(keys("4")).toEqual(["DP-4", "DP-14", "DP-40"]);
  });

  it("puts an exact key above the longer keys it is the start of", () => {
    expect(keys("dp-1")).toEqual(["DP-1", "DP-14"]);
  });

  it("finds words in the title, and prefers a title that starts with them", () => {
    expect(keys("log")).toEqual(["DP-1", "DP-14"]);
  });

  it("finds words in the description and says which line they were on", () => {
    const [hit] = searchTasks(TASKS, "screenshots");
    expect(hit.task.key).toBe("DP-14");
    expect(hit.snippet).toBe("Screenshots of the log in box.");
  });

  it("carries no line when the title already says why", () => {
    expect(searchTasks(TASKS, "guide")[0].snippet).toBeNull();
  });

  it("narrows on every word, wherever each one sits", () => {
    expect(keys("login guide")).toEqual(["DP-14"]);
    // One word in the title, the other in the description.
    expect(keys("guide screenshots")).toEqual(["DP-14"]);
    expect(keys("login image")).toEqual([]);
  });

  it("puts the task changed most recently first when two hits are equally good", () => {
    const same = [
      task({ number: 8, title: "Same words here", updatedAt: "2026-01-02T00:00:00.000Z" }),
      task({ number: 9, title: "Same words here", updatedAt: "2026-03-01T00:00:00.000Z" }),
    ];
    expect(keys("same words", same)).toEqual(["DP-9", "DP-8"]);
  });

  it("puts a live hit above an archived one, and the newest archived first", () => {
    const same = [
      task({ number: 7, title: "Same words here", archivedAt: "2026-01-05T00:00:00.000Z" }),
      task({ number: 8, title: "Same words here", archivedAt: "2026-09-05T00:00:00.000Z" }),
      task({ number: 9, title: "Same words here", updatedAt: "2025-01-01T00:00:00.000Z" }),
    ];
    expect(keys("same words", same)).toEqual(["DP-9", "DP-8", "DP-7"]);
  });

  it("orders an archived task by when it was archived, with no updatedAt", () => {
    const shape = (number: number, archivedAt: string) => ({
      id: `t-${number}`,
      number,
      key: `DP-${number}`,
      title: "Same words here",
      description: "",
      position: String(number).padStart(3, "0"),
      archivedAt,
    });
    const hits = searchTasks(
      [shape(1, "2026-01-01T00:00:00.000Z"), shape(2, "2026-05-01T00:00:00.000Z")],
      "same words",
    );
    expect(hits.map((hit) => hit.task.key)).toEqual(["DP-2", "DP-1"]);
  });

  it("still puts a key match above a newer title match", () => {
    const both = [
      task({ number: 3, title: "Old one", updatedAt: "2025-01-01T00:00:00.000Z" }),
      task({ number: 5, title: "Says dp-3 here", updatedAt: "2026-09-01T00:00:00.000Z" }),
    ];
    expect(keys("dp-3", both)).toEqual(["DP-3", "DP-5"]);
  });

  it("keeps the order every view shares when two hits are equally good and equally new", () => {
    const same = [
      task({ number: 9, title: "Same words here", position: "s" }),
      task({ number: 8, title: "Same words here", position: "V" }),
      task({ number: 7, title: "Same words here", position: "a", archivedAt: WHEN }),
      task({ number: 6, title: "Same words here", position: "Z", archivedAt: WHEN }),
    ];
    expect(keys("same words", same)).toEqual(["DP-8", "DP-9", "DP-6", "DP-7"]);
  });

  it("orders before it cuts to the limit", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      task({ number: i + 1, title: "Same words here" }),
    );
    many.push(task({ number: 99, title: "Same words here", updatedAt: WHEN }));
    expect(keys("same words", many)[0]).toBe("DP-99");
  });

  it("draws no more than it was asked for", () => {
    expect(searchTasks(TASKS, "dp", null, 2)).toHaveLength(2);
  });

  it("leaves the left-out tasks out before it cuts the list", () => {
    /* Twelve linked parts would fill the box; the thirteenth is the one the
       link box can still offer. */
    const linked = Array.from({ length: 12 }, (_, i) =>
      task({ number: i + 1, title: "Checkout", updatedAt: WHEN }),
    );
    const free = task({ number: 13, title: "Checkout" });
    const all = [...linked, free];
    const taken = new Set(linked.map((t) => t.id));

    /* With nothing left out, as the top bar asks, the linked ones are found. */
    expect(keys("checkout", all)).toEqual(linked.map((t) => t.key));
    expect(searchTasks(all, "checkout", null, 12, taken).map((h) => h.task.key)).toEqual(["DP-13"]);
  });

  describe("with the project's Done when", () => {
    const DONE = { propertyId: "status", optionIds: ["done"] };
    const doneTask = (over: Partial<TaskDTO> & { number: number }) =>
      task({ values: { status: "done" }, ...over });
    const doneKeys = (query: string, tasks: TaskDTO[]) =>
      searchTasks(tasks, query, DONE).map((hit) => hit.task.key);

    it("puts the open task before the done one, even when the done one is newer", () => {
      const both = [
        doneTask({ number: 2, title: "Same words here", updatedAt: "2026-09-01T00:00:00.000Z" }),
        task({ number: 3, title: "Same words here", values: { status: "doing" } }),
      ];
      expect(doneKeys("same words", both)).toEqual(["DP-3", "DP-2"]);
    });

    it("still puts a key match on a done task above a title match on an open one", () => {
      const both = [
        doneTask({ number: 3, title: "Old one" }),
        task({ number: 5, title: "Says dp-3 here", updatedAt: "2026-09-01T00:00:00.000Z" }),
      ];
      expect(doneKeys("dp-3", both)).toEqual(["DP-3", "DP-5"]);
    });

    it("puts a done live task before an archived one", () => {
      const three = [
        task({ number: 1, title: "Same words here", archivedAt: "2026-09-02T00:00:00.000Z" }),
        doneTask({ number: 2, title: "Same words here" }),
        task({ number: 3, title: "Same words here", updatedAt: "2025-01-01T00:00:00.000Z" }),
      ];
      expect(doneKeys("same words", three)).toEqual(["DP-3", "DP-2", "DP-1"]);
    });

    it("keeps newest first, then the shared order, inside the done tasks", () => {
      const done = [
        doneTask({ number: 7, title: "Same words here", position: "s" }),
        doneTask({ number: 8, title: "Same words here", position: "V" }),
        doneTask({ number: 9, title: "Same words here", updatedAt: WHEN }),
      ];
      expect(doneKeys("same words", done)).toEqual(["DP-9", "DP-8", "DP-7"]);
    });

    it("reads an archived task with no values as archived", () => {
      const gone = {
        id: "t-1",
        number: 1,
        key: "DP-1",
        title: "Same words here",
        description: "",
        position: "001",
        archivedAt: "2026-09-02T00:00:00.000Z",
      };
      const live = doneTask({ number: 2, title: "Same words here" });
      expect(searchTasks([gone, live], "same words", DONE).map((h) => h.task.key)).toEqual([
        "DP-2",
        "DP-1",
      ]);
    });
  });

  it("finds an archived task, because nothing else can reach one", () => {
    const gone = task({ number: 20, title: "Ship the release image", archivedAt: WHEN });
    expect(keys("release", [...TASKS, gone])).toContain("DP-20");
  });
});

describe("The word on a hit", () => {
  it("says nothing about a task the view is drawing", () => {
    expect(hitNote(task({ number: 1 }), true)).toBeNull();
  });

  it("says so when the view is not drawing it", () => {
    expect(hitNote(task({ number: 1 }), false)).toBe("not in this view");
  });

  it("says archived, which is the stronger reason of the two", () => {
    const gone = task({ number: 1, archivedAt: WHEN });
    expect(hitNote(gone, false)).toBe("archived");
    /* No view draws an archived task, so the flag the caller worked out from
       the view it is on must not be able to change the word. */
    expect(hitNote(gone, true)).toBe("archived");
  });
});

describe("searchCounted", () => {
  const many = Array.from({ length: 20 }, (_, i) => task({ number: i + 1, title: "Checkout" }));

  it("counts every hit before the cut", () => {
    const { hits, total } = searchCounted(many, "checkout");
    expect(hits).toHaveLength(12);
    expect(total).toBe(20);
    // The wrapper hands back the same hits and nothing else.
    expect(searchTasks(many, "checkout")).toEqual(hits);
  });

  it("does not count what was left out", () => {
    const taken = new Set(many.slice(0, 5).map((t) => t.id));
    expect(searchCounted(many, "checkout", null, 12, taken).total).toBe(15);
  });

  it("counts a short list in full", () => {
    const { hits, total } = searchCounted(many.slice(0, 3), "checkout");
    expect(hits).toHaveLength(3);
    expect(total).toBe(3);
  });
});
