import { describe, expect, it } from "vitest";
import {
  allowedColumns,
  applyFilters,
  describeRule,
  hasAnswer,
  matches,
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

const members: MemberDTO[] = [
  { id: "u-ada", name: "Ada", email: "a@x.io", color: "#6d5bd0", role: "owner", kind: "human" },
  { id: "u-bot", name: "Scribe", email: null, color: "#2f9e7a", role: "member", kind: "agent" },
];

function task(id: string, values: TaskDTO["values"] = {}): TaskDTO {
  return {
    id,
    number: 1,
    key: `USH-${id}`,
    title: id,
    description: "",
    position: "V",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    values,
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
  };
}

function keep(rule: FilterRule, values: TaskDTO["values"], property: PropertyDTO) {
  return matches(task("t", values), rule, property);
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
    );
    expect(two.map((t) => t.id)).toEqual(["a"]);
  });

  it("hands back the same list when there is no rule", () => {
    expect(applyFilters(tasks, { rules: [] }, properties)).toBe(tasks);
  });

  it("ignores a rule whose property has gone", () => {
    const gone = applyFilters(
      tasks,
      { rules: [{ propertyId: "p-vanished", op: "is", values: ["x"] }] },
      properties,
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
    expect(seedValues({ rules }, properties, null)).toEqual({ "p-status": "o-todo" });
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
    expect(allowedColumns(columns, filters, status)).toHaveLength(3);
  });

  it("drops the columns a card could not live in", () => {
    const filters = { rules: [{ propertyId: status.id, op: "is" as const, values: ["o-todo"] }] };
    expect(allowedColumns(columns, filters, status).map((c) => c.id)).toEqual(["o-todo"]);
  });

  it("keeps the no-value column when the rule names Empty", () => {
    const filters = {
      rules: [{ propertyId: status.id, op: "is" as const, values: ["o-todo", NO_VALUE_KEY] }],
    };
    expect(allowedColumns(columns, filters, status).map((c) => c.id)).toEqual(["o-todo", "none"]);
  });

  it("drops only the named column for is not", () => {
    const filters = {
      rules: [{ propertyId: status.id, op: "is_not" as const, values: ["o-done"] }],
    };
    expect(allowedColumns(columns, filters, status).map((c) => c.id)).toEqual(["o-todo", "none"]);
  });

  it("keeps them all when the board groups by nothing", () => {
    const filters = { rules: [{ propertyId: status.id, op: "is" as const, values: ["o-todo"] }] };
    expect(allowedColumns(columns, filters, null)).toHaveLength(3);
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

  it("counts zero, which is a number somebody meant", () => {
    expect(hasAnswer({ propertyId: estimate.id, op: "eq", text: "0" })).toBe(true);
    expect(
      matches(
        task("a", { "p-estimate": 0 }),
        { propertyId: estimate.id, op: "eq", text: "0" },
        estimate,
      ),
    ).toBe(true);
  });
});
