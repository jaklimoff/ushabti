import { describe, expect, it } from "vitest";
import { DATE_WINDOWS } from "../day";
import {
  allowedColumns,
  applyFilters,
  BLOCKED_KEY,
  BLOCKED_PROPERTY,
  filterProperties,
  asksAbout,
  clashOf,
  clashSaid,
  describeRule,
  hasAnswer,
  matches,
  mergeFilters,
  readFilters,
  seedNote,
  seedValues,
} from "../filters";
import {
  NO_VALUE_KEY,
  type FilterRule,
  type MemberDTO,
  type PropertyDTO,
  type TaskDTO,
} from "../types";

const status: PropertyDTO = {
  id: "p-status",
  name: "Status",
  type: "select",
  position: "V",
  config: {},
  options: [
    { id: "o-todo", name: "Todo", color: "#9aa0aa", position: "V" },
    { id: "o-done", name: "Done", color: "#4f8a5b", position: "k" },
  ],
};

const labels: PropertyDTO = {
  id: "p-labels",
  name: "Labels",
  type: "multi_select",
  position: "W",
  config: {},
  options: [
    { id: "o-bug", name: "bug", color: "#e0574d", position: "V" },
    { id: "o-ux", name: "ux", color: "#c2557a", position: "k" },
  ],
};

const assignee: PropertyDTO = {
  id: "p-assignee",
  name: "Assignee",
  type: "person",
  position: "X",
  config: {},
  options: [],
};

const due: PropertyDTO = {
  id: "p-due",
  name: "Due",
  type: "date",
  position: "Y",
  config: {},
  options: [],
};

const estimate: PropertyDTO = {
  id: "p-estimate",
  name: "Estimate",
  type: "number",
  position: "Z",
  config: {},
  options: [],
};

const notes: PropertyDTO = {
  id: "p-notes",
  name: "Notes",
  type: "text",
  position: "a",
  config: {},
  options: [],
};

const blocked: PropertyDTO = {
  id: "p-blocked",
  name: "Blocked",
  type: "checkbox",
  position: "b",
  config: {},
  options: [],
};

const properties = [status, labels, assignee, due, estimate, notes, blocked];

/*
 * The day the board was read on. It is handed to every rule rather than
 * looked up, so these tests answer the same thing in every zone and on every
 * day — which is the whole point of `today` being an argument.
 *
 * 2026-09-21 is a Monday.
 */
const TODAY = "2026-09-21";

const members: MemberDTO[] = [
  {
    id: "u-ada",
    name: "Ada",
    email: "a@x.io",
    color: "#6d5bd0",
    role: "owner",
    kind: "human",
    listeningAt: null,
  },
  {
    id: "u-bot",
    name: "Scribe",
    email: null,
    color: "#2f9e7a",
    role: "member",
    kind: "agent",
    listeningAt: null,
  },
];

function task(id: string, values: TaskDTO["values"] = {}, blockedBy: string[] = []): TaskDTO {
  return {
    id,
    number: 1,
    key: `USH-${id}`,
    title: id,
    description: "",
    position: "V",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    values,
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    blockedBy,
  };
}

function keep(rule: FilterRule, values: TaskDTO["values"], property: PropertyDTO) {
  return matches(task("t", values), rule, property, TODAY);
}

describe("a select rule", () => {
  const rule: FilterRule = { propertyId: status.id, op: "is", values: ["o-todo"] };

  it("keeps a task whose option was named", () => {
    expect(keep(rule, { "p-status": "o-todo" }, status)).toBe(true);
  });

  it("drops a task with another option", () => {
    expect(keep(rule, { "p-status": "o-done" }, status)).toBe(false);
  });

  it("drops a task with no value", () => {
    expect(keep(rule, {}, status)).toBe(false);
  });

  it("keeps a task with no value when the rule names Empty", () => {
    const empty: FilterRule = { propertyId: status.id, op: "is", values: [NO_VALUE_KEY] };
    expect(keep(empty, {}, status)).toBe(true);
    expect(keep(empty, { "p-status": null }, status)).toBe(true);
    expect(keep(empty, { "p-status": "" }, status)).toBe(true);
    expect(keep(empty, { "p-status": "o-todo" }, status)).toBe(false);
  });

  it("turns around for is not", () => {
    const not: FilterRule = { propertyId: status.id, op: "is_not", values: ["o-todo"] };
    expect(keep(not, { "p-status": "o-todo" }, status)).toBe(false);
    expect(keep(not, { "p-status": "o-done" }, status)).toBe(true);
    // A task with nothing in it is not Todo, so it stays.
    expect(keep(not, {}, status)).toBe(true);
  });

  it("asks nothing when no option is chosen", () => {
    const none: FilterRule = { propertyId: status.id, op: "is", values: [] };
    expect(keep(none, { "p-status": "o-done" }, status)).toBe(true);
  });

  it("keeps a task that holds any one of several options", () => {
    const either: FilterRule = { propertyId: status.id, op: "is", values: ["o-todo", "o-done"] };
    expect(keep(either, { "p-status": "o-done" }, status)).toBe(true);
  });
});

describe("a multi-select rule", () => {
  it("keeps a task that carries one of the named options", () => {
    const rule: FilterRule = { propertyId: labels.id, op: "is", values: ["o-bug"] };
    expect(keep(rule, { "p-labels": ["o-ux", "o-bug"] }, labels)).toBe(true);
    expect(keep(rule, { "p-labels": ["o-ux"] }, labels)).toBe(false);
  });

  it("treats an empty list as no value", () => {
    const empty: FilterRule = { propertyId: labels.id, op: "is", values: [NO_VALUE_KEY] };
    expect(keep(empty, { "p-labels": [] }, labels)).toBe(true);
    expect(keep(empty, {}, labels)).toBe(true);
    expect(keep(empty, { "p-labels": ["o-bug"] }, labels)).toBe(false);
  });

  it("drops every task that carries the option, for is not", () => {
    const not: FilterRule = { propertyId: labels.id, op: "is_not", values: ["o-bug"] };
    expect(keep(not, { "p-labels": ["o-bug", "o-ux"] }, labels)).toBe(false);
    expect(keep(not, { "p-labels": ["o-ux"] }, labels)).toBe(true);
  });
});

describe("a person rule", () => {
  it("names a member, an agent or nobody", () => {
    const mine: FilterRule = { propertyId: assignee.id, op: "is", values: ["u-ada"] };
    expect(keep(mine, { "p-assignee": "u-ada" }, assignee)).toBe(true);
    expect(keep(mine, { "p-assignee": "u-bot" }, assignee)).toBe(false);

    const nobody: FilterRule = { propertyId: assignee.id, op: "is", values: [NO_VALUE_KEY] };
    expect(keep(nobody, {}, assignee)).toBe(true);
  });
});

describe("a checkbox rule", () => {
  it("reads off as a value, not as empty", () => {
    const off: FilterRule = { propertyId: blocked.id, op: "is", values: ["false"] };
    expect(keep(off, {}, blocked)).toBe(true);
    expect(keep(off, { "p-blocked": false }, blocked)).toBe(true);
    expect(keep(off, { "p-blocked": true }, blocked)).toBe(false);

    const on: FilterRule = { propertyId: blocked.id, op: "is", values: ["true"] };
    expect(keep(on, { "p-blocked": true }, blocked)).toBe(true);
    expect(keep(on, {}, blocked)).toBe(false);
  });
});

describe("a text rule", () => {
  it("does not care about case", () => {
    const rule: FilterRule = { propertyId: notes.id, op: "contains", text: "SHIP" };
    expect(keep(rule, { "p-notes": "ready to ship" }, notes)).toBe(true);
    expect(keep(rule, { "p-notes": "on hold" }, notes)).toBe(false);
  });

  it("drops a task with nothing written, and keeps it for does not contain", () => {
    const has: FilterRule = { propertyId: notes.id, op: "contains", text: "ship" };
    const hasnt: FilterRule = { propertyId: notes.id, op: "not_contains", text: "ship" };
    expect(keep(has, {}, notes)).toBe(false);
    expect(keep(hasnt, {}, notes)).toBe(true);
  });

  it("asks nothing while the box is still empty", () => {
    const blank: FilterRule = { propertyId: notes.id, op: "contains", text: "  " };
    expect(keep(blank, { "p-notes": "anything" }, notes)).toBe(true);
  });
});

describe("a number rule", () => {
  it("compares", () => {
    const over: FilterRule = { propertyId: estimate.id, op: "gt", text: "3" };
    expect(keep(over, { "p-estimate": 5 }, estimate)).toBe(true);
    expect(keep(over, { "p-estimate": 3 }, estimate)).toBe(false);
    expect(keep(over, {}, estimate)).toBe(false);

    const exact: FilterRule = { propertyId: estimate.id, op: "eq", text: "3" };
    expect(keep(exact, { "p-estimate": 3 }, estimate)).toBe(true);

    const under: FilterRule = { propertyId: estimate.id, op: "lt", text: "3" };
    expect(keep(under, { "p-estimate": 2 }, estimate)).toBe(true);
  });

  it("asks nothing when the box holds no number", () => {
    const junk: FilterRule = { propertyId: estimate.id, op: "gt", text: "soon" };
    expect(keep(junk, { "p-estimate": 1 }, estimate)).toBe(true);
  });
});

describe("a date rule", () => {
  it("reads the text order, which is the date order", () => {
    const before: FilterRule = { propertyId: due.id, op: "before", text: "2026-09-01" };
    expect(keep(before, { "p-due": "2026-08-31" }, due)).toBe(true);
    expect(keep(before, { "p-due": "2026-09-01" }, due)).toBe(false);
    expect(keep(before, { "p-due": "2026-12-01" }, due)).toBe(false);

    const after: FilterRule = { propertyId: due.id, op: "after", text: "2026-09-01" };
    expect(keep(after, { "p-due": "2026-09-02" }, due)).toBe(true);

    const on: FilterRule = { propertyId: due.id, op: "on", text: "2026-09-01" };
    expect(keep(on, { "p-due": "2026-09-01" }, due)).toBe(true);
  });

  it("drops a task with no date", () => {
    const before: FilterRule = { propertyId: due.id, op: "before", text: "2026-09-01" };
    expect(keep(before, {}, due)).toBe(false);
  });
});

/*
 * A relative rule names a window of days instead of one day, and the window
 * is worked out from the day the board was read on. TODAY is a Monday, so
 * "this week" runs to the Sunday after it.
 */
describe("a date rule that names a window", () => {
  const within = (word: string): FilterRule => ({ propertyId: due.id, op: "within", text: word });

  it("keeps the days each word covers", () => {
    expect(keep(within("today"), { "p-due": "2026-09-21" }, due)).toBe(true);
    expect(keep(within("today"), { "p-due": "2026-09-22" }, due)).toBe(false);

    expect(keep(within("tomorrow"), { "p-due": "2026-09-22" }, due)).toBe(true);
    expect(keep(within("tomorrow"), { "p-due": "2026-09-21" }, due)).toBe(false);

    expect(keep(within("this_week"), { "p-due": "2026-09-27" }, due)).toBe(true);
    expect(keep(within("this_week"), { "p-due": "2026-09-28" }, due)).toBe(false);
    expect(keep(within("this_week"), { "p-due": "2026-09-20" }, due)).toBe(false);

    expect(keep(within("next_week"), { "p-due": "2026-09-28" }, due)).toBe(true);
    expect(keep(within("next_week"), { "p-due": "2026-10-04" }, due)).toBe(true);
    expect(keep(within("next_week"), { "p-due": "2026-10-05" }, due)).toBe(false);

    expect(keep(within("last_7"), { "p-due": "2026-09-15" }, due)).toBe(true);
    expect(keep(within("last_7"), { "p-due": "2026-09-14" }, due)).toBe(false);
    expect(keep(within("last_30"), { "p-due": "2026-08-23" }, due)).toBe(true);
    expect(keep(within("last_30"), { "p-due": "2026-08-22" }, due)).toBe(false);

    expect(keep(within("next_7"), { "p-due": "2026-09-27" }, due)).toBe(true);
    expect(keep(within("next_7"), { "p-due": "2026-09-28" }, due)).toBe(false);
    expect(keep(within("next_30"), { "p-due": "2026-10-20" }, due)).toBe(true);
    expect(keep(within("next_30"), { "p-due": "2026-10-21" }, due)).toBe(false);
  });

  /* Overdue is before today and nothing else: the board cannot know what
     done means, so it does not guess at it. */
  it("calls a task overdue when its day has passed, whatever it holds", () => {
    expect(keep(within("overdue"), { "p-due": "2026-09-20" }, due)).toBe(true);
    expect(keep(within("overdue"), { "p-due": "2026-09-21" }, due)).toBe(false);
    expect(keep(within("overdue"), { "p-due": "2026-09-22" }, due)).toBe(false);
  });

  it("drops a task with no date, as every other date rule does", () => {
    for (const word of DATE_WINDOWS) expect(keep(within(word), {}, due)).toBe(false);
  });

  /* An unreadable rule passes everything, exactly as an empty box does. */
  it("hides nothing when the word means nothing here", () => {
    expect(keep(within("this_quarter"), { "p-due": "2026-01-01" }, due)).toBe(true);
  });
});

describe("empty and not empty", () => {
  it("work on every type that can be empty", () => {
    const empty: FilterRule = { propertyId: due.id, op: "empty" };
    expect(keep(empty, {}, due)).toBe(true);
    expect(keep(empty, { "p-due": "2026-09-01" }, due)).toBe(false);

    const filled: FilterRule = { propertyId: due.id, op: "not_empty" };
    expect(keep(filled, { "p-due": "2026-09-01" }, due)).toBe(true);
  });

  it("never call a checkbox empty", () => {
    const empty: FilterRule = { propertyId: blocked.id, op: "empty" };
    expect(keep(empty, {}, blocked)).toBe(false);
  });
});

describe("every rule has to pass", () => {
  const tasks = [
    task("a", { "p-status": "o-todo", "p-labels": ["o-bug"] }),
    task("b", { "p-status": "o-todo", "p-labels": ["o-ux"] }),
    task("c", { "p-status": "o-done", "p-labels": ["o-bug"] }),
  ];

  it("narrows with each one", () => {
    const one = applyFilters(
      tasks,
      { rules: [{ propertyId: status.id, op: "is", values: ["o-todo"] }] },
      properties,
      TODAY,
    );
    expect(one.map((t) => t.id)).toEqual(["a", "b"]);

    const two = applyFilters(
      tasks,
      {
        rules: [
          { propertyId: status.id, op: "is", values: ["o-todo"] },
          { propertyId: labels.id, op: "is", values: ["o-bug"] },
        ],
      },
      properties,
      TODAY,
    );
    expect(two.map((t) => t.id)).toEqual(["a"]);
  });

  it("hands back the same list when there is no rule", () => {
    expect(applyFilters(tasks, { rules: [] }, properties, TODAY)).toBe(tasks);
  });

  it("ignores a rule whose property has gone", () => {
    const gone = applyFilters(
      tasks,
      { rules: [{ propertyId: "p-vanished", op: "is", values: ["x"] }] },
      properties,
      TODAY,
    );
    expect(gone).toHaveLength(3);
  });
});

describe("reading what was saved", () => {
  it("keeps a rule that still makes sense", () => {
    const read = readFilters(
      { rules: [{ propertyId: status.id, op: "is", values: ["o-todo"] }] },
      properties,
    );
    expect(read.rules).toEqual([{ propertyId: status.id, op: "is", values: ["o-todo"] }]);
  });

  it("throws away a rule whose property was deleted", () => {
    const read = readFilters(
      { rules: [{ propertyId: "p-vanished", op: "is", values: ["o-todo"] }] },
      properties,
    );
    expect(read.rules).toEqual([]);
  });

  it("throws away an option that was deleted, and the rule with the last of them", () => {
    const partly = readFilters(
      { rules: [{ propertyId: status.id, op: "is", values: ["o-todo", "o-gone"] }] },
      properties,
    );
    expect(partly.rules[0].values).toEqual(["o-todo"]);

    const wholly = readFilters(
      { rules: [{ propertyId: status.id, op: "is", values: ["o-gone"] }] },
      properties,
    );
    expect(wholly.rules).toEqual([]);
  });

  it("keeps a person rule whose member has left, because the tasks are still there", () => {
    const read = readFilters(
      { rules: [{ propertyId: assignee.id, op: "is", values: ["u-departed"] }] },
      properties,
    );
    expect(read.rules).toHaveLength(1);
  });

  it("throws away an operator the property cannot answer", () => {
    const read = readFilters(
      { rules: [{ propertyId: status.id, op: "contains", text: "todo" }] },
      properties,
    );
    expect(read.rules).toEqual([]);
  });

  it("survives anything at all", () => {
    expect(readFilters(null, properties).rules).toEqual([]);
    expect(readFilters({}, properties).rules).toEqual([]);
    expect(readFilters({ rules: "no" }, properties).rules).toEqual([]);
    expect(readFilters({ rules: [null, 7, "x"] }, properties).rules).toEqual([]);
    expect(readFilters({ rules: [{ propertyId: status.id }] }, properties).rules).toEqual([]);
  });

  /*
   * A question with no answer is not a rule. The panel holds that state while
   * somebody is choosing; nothing that reaches the view may still be in it.
   */
  it("drops a rule with no answer", () => {
    expect(
      readFilters({ rules: [{ propertyId: notes.id, op: "contains", text: "" }] }, properties)
        .rules,
    ).toEqual([]);
    expect(
      readFilters({ rules: [{ propertyId: notes.id, op: "contains", text: "  " }] }, properties)
        .rules,
    ).toEqual([]);
    expect(
      readFilters({ rules: [{ propertyId: status.id, op: "is", values: [] }] }, properties).rules,
    ).toEqual([]);
  });

  it("keeps a bare operator, which is its own answer", () => {
    expect(readFilters({ rules: [{ propertyId: due.id, op: "empty" }] }, properties).rules).toEqual(
      [{ propertyId: due.id, op: "empty" }],
    );
  });

  /*
   * The words a window is made of are a closed list, so a word from a version
   * that knew more is thrown away here, on every read, exactly as a deleted
   * option is. Nothing rewrites a view when the list changes.
   */
  it("keeps a window it knows and throws away a word it does not", () => {
    expect(
      readFilters({ rules: [{ propertyId: due.id, op: "within", text: "this_week" }] }, properties)
        .rules,
    ).toEqual([{ propertyId: due.id, op: "within", text: "this_week" }]);

    for (const word of ["this_quarter", "", "  ", 7, null]) {
      expect(
        readFilters({ rules: [{ propertyId: due.id, op: "within", text: word }] }, properties)
          .rules,
      ).toEqual([]);
    }
  });

  it("refuses a window on a property that is not a date", () => {
    expect(
      readFilters(
        { rules: [{ propertyId: notes.id, op: "within", text: "this_week" }] },
        properties,
      ).rules,
    ).toEqual([]);
  });

  it("refuses text that is not text, and cuts text that is too long", () => {
    expect(
      readFilters({ rules: [{ propertyId: notes.id, op: "contains", text: 7 }] }, properties).rules,
    ).toEqual([]);
    expect(
      readFilters(
        { rules: [{ propertyId: notes.id, op: "contains", text: "x".repeat(500) }] },
        properties,
      ).rules[0].text,
    ).toHaveLength(200);
  });
});

describe("saying what a rule asks", () => {
  it("names the property, the operator and the values", () => {
    expect(
      describeRule({ propertyId: status.id, op: "is", values: ["o-todo"] }, status, members),
    ).toBe("Status is Todo");
    expect(
      describeRule({ propertyId: assignee.id, op: "is_not", values: ["u-ada"] }, assignee, members),
    ).toBe("Assignee is not Ada");
    expect(describeRule({ propertyId: due.id, op: "empty" }, due, members)).toBe("Due is empty");
    expect(
      describeRule({ propertyId: due.id, op: "before", text: "2026-09-01" }, due, members),
    ).toBe("Due is before 2026-09-01");
  });

  /* The chip says the window in the words a person uses, and leaves
     "Overdue" to speak for itself: "Due is overdue" says it twice. */
  it("says the property and the window, and lets Overdue speak for itself", () => {
    expect(describeRule({ propertyId: due.id, op: "within", text: "today" }, due, members)).toBe(
      "Due today",
    );
    expect(
      describeRule({ propertyId: due.id, op: "within", text: "this_week" }, due, members),
    ).toBe("Due this week");
    expect(describeRule({ propertyId: due.id, op: "within", text: "next_7" }, due, members)).toBe(
      "Due in the next 7 days",
    );
    expect(describeRule({ propertyId: due.id, op: "within", text: "overdue" }, due, members)).toBe(
      "Overdue",
    );
  });

  it("counts the rest once a rule names more than two", () => {
    const many = { propertyId: status.id, op: "is" as const, values: ["o-todo", "o-done", "o-x"] };
    expect(describeRule(many, status, members)).toBe("Status is Todo, Done +1");
  });

  /*
   * The chip speaks the language the column headers already speak. A person
   * who has read the board has then already read the filter.
   */
  it("says what the column header says, and does not say it twice", () => {
    expect(
      describeRule({ propertyId: status.id, op: "is", values: [NO_VALUE_KEY] }, status, members),
    ).toBe("No status");
    expect(
      describeRule(
        { propertyId: assignee.id, op: "is", values: [NO_VALUE_KEY] },
        assignee,
        members,
      ),
    ).toBe("Unassigned");
    expect(
      describeRule({ propertyId: blocked.id, op: "is", values: ["true"] }, blocked, members),
    ).toBe("Blocked");
    expect(
      describeRule({ propertyId: blocked.id, op: "is", values: ["false"] }, blocked, members),
    ).toBe("Not blocked");
  });

  it("keeps the property in front once a rule names more than one thing", () => {
    expect(
      describeRule(
        { propertyId: status.id, op: "is", values: ["o-todo", NO_VALUE_KEY] },
        status,
        members,
      ),
    ).toBe("Status is Todo, No status");
  });
});

describe("a task added to a filtered board", () => {
  it("is born with what the filter asks for", () => {
    const seed = seedValues(
      {
        rules: [
          { propertyId: assignee.id, op: "is", values: ["u-ada"] },
          { propertyId: labels.id, op: "is", values: ["o-bug"] },
          { propertyId: blocked.id, op: "is", values: ["true"] },
        ],
      },
      properties,
      status.id,
    );
    expect(seed).toEqual({
      "p-assignee": "u-ada",
      "p-labels": ["o-bug"],
      "p-blocked": true,
    });
  });

  it("leaves alone what it cannot answer without guessing", () => {
    const seed = seedValues(
      {
        rules: [
          // Two answers, so no answer.
          { propertyId: status.id, op: "is", values: ["o-todo", "o-done"] },
          // "Not Low" is every other value.
          { propertyId: labels.id, op: "is_not", values: ["o-bug"] },
          // "Nothing" is what a task holds anyway.
          { propertyId: assignee.id, op: "is", values: [NO_VALUE_KEY] },
          // A date is not a set.
          { propertyId: due.id, op: "before", text: "2026-09-01" },
        ],
      },
      properties,
      null,
    );
    expect(seed).toEqual({});
  });

  it("never answers for the grouping property, which the column decides", () => {
    const rules = [{ propertyId: status.id, op: "is" as const, values: ["o-todo"] }];
    expect(seedValues({ rules }, properties, status.id)).toEqual({});
    /*
     * A list has no columns, so nothing else decides it and the filter has to
     * answer for it too. This is the whole difference between the two callers,
     * and without it a row added to a filtered list is written and hidden in
     * the same breath.
     */
    expect(seedValues({ rules }, properties, null)).toEqual({ "p-status": "o-todo" });
  });

  /*
   * Which day inside "this week" a new task means is a guess, and this
   * function never guesses. So the row is written with no date and the filter
   * hides it — the cost "Priority is High or Urgent" already carries.
   */
  it("leaves a relative date rule alone, because it cannot answer it", () => {
    const rules = [{ propertyId: due.id, op: "within" as const, text: "this_week" }];
    expect(seedValues({ rules }, properties, null)).toEqual({});
    expect(seedValues({ rules }, properties, status.id)).toEqual({});
  });

  it("says out loud what it is about to write", () => {
    const seed = { "p-assignee": "u-ada", "p-labels": ["o-bug"] };
    expect(seedNote(seed, properties, members)).toBe("sets Assignee Ada, Labels bug");
    expect(seedNote({}, properties, members)).toBe("");
  });
});

describe("the columns a filtered board keeps", () => {
  const columns = [
    { id: "o-todo", value: "o-todo" as const },
    { id: "o-done", value: "o-done" as const },
    { id: "none", value: null },
  ];

  it("keeps them all when no rule names the grouping property", () => {
    const filters = { rules: [{ propertyId: labels.id, op: "is" as const, values: ["o-bug"] }] };
    expect(allowedColumns(columns, filters, status, TODAY)).toHaveLength(3);
  });

  it("drops the columns a card could not live in", () => {
    const filters = { rules: [{ propertyId: status.id, op: "is" as const, values: ["o-todo"] }] };
    expect(allowedColumns(columns, filters, status, TODAY).map((c) => c.id)).toEqual(["o-todo"]);
  });

  it("keeps the no-value column when the rule names Empty", () => {
    const filters = {
      rules: [{ propertyId: status.id, op: "is" as const, values: ["o-todo", NO_VALUE_KEY] }],
    };
    expect(allowedColumns(columns, filters, status, TODAY).map((c) => c.id)).toEqual([
      "o-todo",
      "none",
    ]);
  });

  it("drops only the named column for is not", () => {
    const filters = {
      rules: [{ propertyId: status.id, op: "is_not" as const, values: ["o-done"] }],
    };
    expect(allowedColumns(columns, filters, status, TODAY).map((c) => c.id)).toEqual([
      "o-todo",
      "none",
    ]);
  });

  it("keeps them all when the board groups by nothing", () => {
    const filters = { rules: [{ propertyId: status.id, op: "is" as const, values: ["o-todo"] }] };
    expect(allowedColumns(columns, filters, null, TODAY)).toHaveLength(3);
  });
});

describe("a question with an answer", () => {
  it("needs a value, or some text, or an operator that is its own answer", () => {
    expect(hasAnswer({ propertyId: status.id, op: "is", values: [] })).toBe(false);
    expect(hasAnswer({ propertyId: status.id, op: "is", values: ["o-todo"] })).toBe(true);
    expect(hasAnswer({ propertyId: notes.id, op: "contains", text: "" })).toBe(false);
    expect(hasAnswer({ propertyId: notes.id, op: "contains", text: "  " })).toBe(false);
    expect(hasAnswer({ propertyId: notes.id, op: "contains", text: "ship" })).toBe(true);
    expect(hasAnswer({ propertyId: due.id, op: "empty" })).toBe(true);
  });

  /* A wordless "is within" is a question, so nothing is written and no chip
     is drawn until somebody picks a window. `hasAnswer` needs no case for it:
     a window is read off `text` like a date. */
  it("needs a window before a relative rule means anything", () => {
    expect(hasAnswer({ propertyId: due.id, op: "within", text: "" })).toBe(false);
    expect(hasAnswer({ propertyId: due.id, op: "within" })).toBe(false);
    expect(hasAnswer({ propertyId: due.id, op: "within", text: "this_week" })).toBe(true);
  });

  it("counts zero, which is a number somebody meant", () => {
    expect(hasAnswer({ propertyId: estimate.id, op: "eq", text: "0" })).toBe(true);
    expect(
      matches(
        task("a", { "p-estimate": 0 }),
        { propertyId: estimate.id, op: "eq", text: "0" },
        estimate,
        TODAY,
      ),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* The view's rules and mine                                           */
/* ------------------------------------------------------------------ */

describe("a view's rules and one person's", () => {
  const ofView: FilterRule = { propertyId: labels.id, op: "is", values: ["o-bug"] };
  const mine: FilterRule = { propertyId: status.id, op: "is", values: ["o-todo"] };

  it("puts the view's first and mine after, because that is how the strip reads", () => {
    expect(mergeFilters({ rules: [ofView] }, { rules: [mine] }).rules).toEqual([ofView, mine]);
  });

  it("answers one set when the other is empty", () => {
    expect(mergeFilters({ rules: [ofView] }, { rules: [] }).rules).toEqual([ofView]);
    expect(mergeFilters({ rules: [] }, { rules: [mine] }).rules).toEqual([mine]);
    expect(mergeFilters({ rules: [] }, { rules: [] }).rules).toEqual([]);
  });

  /* This is the whole rule of the feature: mine narrows, and can never widen. */
  it("narrows and never widens", () => {
    const tasks = [
      task("a", { "p-status": "o-todo", "p-labels": ["o-bug"] }),
      task("b", { "p-status": "o-done", "p-labels": ["o-bug"] }),
      task("c", { "p-status": "o-todo", "p-labels": ["o-ux"] }),
    ];

    const shared = applyFilters(tasks, { rules: [ofView] }, properties, TODAY);
    expect(shared.map((t) => t.id)).toEqual(["a", "b"]);

    const both = applyFilters(
      tasks,
      mergeFilters({ rules: [ofView] }, { rules: [mine] }),
      properties,
      TODAY,
    );
    expect(both.map((t) => t.id)).toEqual(["a"]);

    // Adding a rule of my own can only take cards away from what the view shows.
    const ids = new Set(shared.map((t) => t.id));
    expect(both.every((t) => ids.has(t.id))).toBe(true);
  });

  it("drops a column when either set names the grouping property", () => {
    const columns = [
      { id: "c1", value: "o-todo" },
      { id: "c2", value: "o-done" },
    ];
    const byView = allowedColumns(
      columns,
      mergeFilters({ rules: [mine] }, { rules: [] }),
      status,
      TODAY,
    );
    const byMine = allowedColumns(
      columns,
      mergeFilters({ rules: [] }, { rules: [mine] }),
      status,
      TODAY,
    );
    expect(byView.map((c) => c.id)).toEqual(["c1"]);
    expect(byMine.map((c) => c.id)).toEqual(["c1"]);
  });

  /* Otherwise my own lens hides the card I just made, and nothing says why. */
  it("seeds a task for both sets", () => {
    const seed = seedValues(mergeFilters({ rules: [ofView] }, { rules: [mine] }), properties, null);
    expect(seed).toEqual({ "p-labels": ["o-bug"], "p-status": "o-todo" });
  });

  /*
   * A lens is saved once and read for months, so it outlives the option it
   * names exactly as a view's rule does. Both sets go through the same reading.
   */
  it("is read afresh on both sets", () => {
    // Each set holds one rule that can still be read and one that cannot: an
    // option that was deleted, and a property that was.
    const savedView = {
      rules: [
        { propertyId: labels.id, op: "is", values: ["o-bug"] },
        { propertyId: status.id, op: "is", values: ["o-gone"] },
      ],
    };
    const savedLens = {
      rules: [
        { propertyId: "p-gone", op: "is", values: ["o-x"] },
        { propertyId: status.id, op: "is", values: ["o-todo"] },
      ],
    };

    const merged = mergeFilters(
      readFilters(savedView, properties),
      readFilters(savedLens, properties),
    );

    // What is left is one rule from each set, the view's first — and no rule
    // that nobody can see is still hiding cards.
    expect(merged.rules).toEqual([
      { propertyId: labels.id, op: "is", values: ["o-bug"] },
      { propertyId: status.id, op: "is", values: ["o-todo"] },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Two rules about one property                                        */
/* ------------------------------------------------------------------ */

describe("a rule of mine about a property the view already filters", () => {
  const ofView: FilterRule = { propertyId: status.id, op: "is", values: ["o-todo"] };

  it("says when a set already asks about a property", () => {
    expect(asksAbout({ rules: [ofView] }, status.id)).toBe(true);
    expect(asksAbout({ rules: [ofView] }, labels.id)).toBe(false);
    expect(asksAbout({ rules: [] }, status.id)).toBe(false);
  });

  /* The trap the guard exists for: two chips, an empty board, no reason. */
  it("names the property both sets speak about", () => {
    const mine: FilterRule = { propertyId: status.id, op: "is", values: ["o-done"] };
    expect(clashOf({ rules: [ofView] }, { rules: [mine] }, properties)).toBe(status);
  });

  it("finds nothing when the two sets speak about different properties", () => {
    const mine: FilterRule = { propertyId: labels.id, op: "is", values: ["o-bug"] };
    expect(clashOf({ rules: [ofView] }, { rules: [mine] }, properties)).toBeNull();
    expect(clashOf({ rules: [ofView] }, { rules: [] }, properties)).toBeNull();
    expect(clashOf({ rules: [] }, { rules: [mine] }, properties)).toBeNull();
  });

  /* A person who reads two chips cannot tell a pair that narrows from a pair
     that can never both pass, so the property is what counts. */
  it("counts the property and not the operator", () => {
    const mine: FilterRule = { propertyId: status.id, op: "is_not", values: ["o-done"] };
    expect(clashOf({ rules: [ofView] }, { rules: [mine] }, properties)).toBe(status);

    const before: FilterRule = { propertyId: due.id, op: "before", text: "2026-06-01" };
    const after: FilterRule = { propertyId: due.id, op: "after", text: "2026-03-01" };
    expect(clashOf({ rules: [before] }, { rules: [after] }, properties)).toBe(due);
  });

  /* A window is a rule about the same property, so it is counted with the
     rest and `clashOf` needs no case of its own for it. */
  it("counts a window like any other rule about that property", () => {
    const mine: FilterRule = { propertyId: due.id, op: "within", text: "this_week" };
    const dated: FilterRule = { propertyId: due.id, op: "before", text: "2026-06-01" };
    expect(clashOf({ rules: [dated] }, { rules: [mine] }, properties)).toBe(due);
    expect(clashOf({ rules: [mine] }, { rules: [dated] }, properties)).toBe(due);
    expect(clashOf({ rules: [ofView] }, { rules: [mine] }, properties)).toBeNull();
  });

  /*
   * What both doors do, and in this order: read each set afresh, then ask.
   * The lens route asks it on the way in and the promote route on the way out,
   * so neither can hold a different idea of what a clash is.
   */
  it("is what a door asks, after reading both sets afresh", () => {
    const savedView = { rules: [{ propertyId: status.id, op: "is", values: ["o-todo"] }] };
    const savedLens = { rules: [{ propertyId: status.id, op: "is_not", values: ["o-done"] }] };

    const clash = clashOf(
      readFilters(savedView, properties),
      readFilters(savedLens, properties),
      properties,
    );
    expect(clash).toBe(status);
    expect(clash ? clashSaid(clash) : "").toBe(
      "The view already filters Status. Remove it for everyone first.",
    );
  });

  /*
   * It answers null for a property it cannot name, and both doors read their
   * sets afresh first, so a rule about a deleted property never reaches it:
   * `readFilters` has already thrown that rule away.
   */
  it("finds nothing when the property is gone", () => {
    const gone: FilterRule = { propertyId: "p-gone", op: "is", values: ["o-x"] };
    expect(clashOf({ rules: [gone] }, { rules: [gone] }, properties)).toBeNull();
  });

  it("is never asked about a deleted property, because a door reads first", () => {
    const savedView = { rules: [{ propertyId: "p-gone", op: "is", values: ["o-x"] }] };
    const savedLens = { rules: [{ propertyId: "p-gone", op: "is", values: ["o-y"] }] };

    const ofView = readFilters(savedView, properties);
    const mine = readFilters(savedLens, properties);
    // Both sets are empty by the time the guard sees them, so there is no
    // property to fail open about.
    expect(ofView.rules).toEqual([]);
    expect(mine.rules).toEqual([]);
    expect(clashOf(ofView, mine, properties)).toBeNull();
  });

  /* One sentence, said the same way by the panel and by the promote route. */
  it("says the property by name and where the way out is", () => {
    expect(clashSaid(status)).toBe(
      "The view already filters Status. Remove it for everyone first.",
    );
  });
});

/* ------------------------------------------------------------------ */
/* The one rule that is not about a property                           */
/* ------------------------------------------------------------------ */

describe("the blocked rule", () => {
  const blocked: FilterRule = { propertyId: BLOCKED_KEY, op: "is", values: ["true"] };
  const free: FilterRule = { propertyId: BLOCKED_KEY, op: "is", values: ["false"] };

  it("is offered beside the properties and is not one of them", () => {
    const askable = filterProperties([status]);
    expect(askable.map((p) => p.id)).toEqual(["p-status", BLOCKED_KEY]);
    expect(BLOCKED_PROPERTY.type).toBe("checkbox");
  });

  it("keeps a task that waits on another", () => {
    expect(matches(task("t", {}, ["USH-2"]), blocked, BLOCKED_PROPERTY, TODAY)).toBe(true);
    expect(matches(task("t", {}, []), blocked, BLOCKED_PROPERTY, TODAY)).toBe(false);
  });

  it("keeps a task that waits on nothing", () => {
    expect(matches(task("t", {}, []), free, BLOCKED_PROPERTY, TODAY)).toBe(true);
    expect(matches(task("t", {}, ["USH-2"]), free, BLOCKED_PROPERTY, TODAY)).toBe(false);
  });

  it("hides the cards it names, with only the project's properties passed in", () => {
    const tasks = [task("a", {}, ["USH-2"]), task("b")];
    expect(applyFilters(tasks, { rules: [blocked] }, [status], TODAY).map((t) => t.id)).toEqual([
      "a",
    ]);
  });

  /* The word cannot be deleted, so the rule always survives the read that
     throws away a rule about a property that is gone. */
  it("survives readFilters when no property is named", () => {
    const read = readFilters({ rules: [blocked] }, []);
    expect(read.rules).toEqual([blocked]);
  });

  it("is still thrown away when it holds no answer", () => {
    const read = readFilters({ rules: [{ propertyId: BLOCKED_KEY, op: "is", values: [] }] }, []);
    expect(read.rules).toEqual([]);
  });

  it("is never seeded onto a new task", () => {
    expect(seedValues({ rules: [blocked] }, [status], null)).toEqual({});
  });

  it("reads as a checkbox on the chip", () => {
    expect(describeRule(blocked, BLOCKED_PROPERTY, members)).toBe("Blocked");
    expect(describeRule(free, BLOCKED_PROPERTY, members)).toBe("Not blocked");
  });

  it("clashes with itself across the two sets", () => {
    const clash = clashOf({ rules: [blocked] }, { rules: [free] }, [status]);
    expect(clash?.name).toBe("Blocked");
  });
});
