import { describe, expect, it } from "vitest";
import { buildColumns, NO_VALUE } from "../board";
import { buildCard, cardItems, readCardView } from "../card-view";
import { applyFilters, describeRule, keyName, seedValues } from "../filters";
import { personOf } from "../people";
import { sortTasks } from "../sort";
import type { FormerDTO, MemberDTO, PropertyDTO, TaskDTO } from "../types";

const ASSIGNEE: PropertyDTO = {
  id: "p-who",
  name: "Assignee",
  type: "person",
  position: "s",
  config: {},
  options: [],
};

const ADA: MemberDTO = {
  id: "u-ada",
  name: "Ada",
  email: "ada@example.com",
  color: "#6d5bd0",
  emoji: null,
  role: "owner",
  kind: "human",
  listeningAt: null,
};

const GRACE: FormerDTO = {
  id: "u-grace",
  name: "Grace",
  color: "#2f9e8f",
  emoji: null,
  kind: "human",
};

function task(id: string, who: string | null): TaskDTO {
  return {
    id,
    number: 1,
    key: `USH-${id}`,
    title: id,
    description: "",
    position: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    values: who ? { [ASSIGNEE.id]: who } : {},
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    blockedBy: [],
    parts: null,
  };
}

const TASKS = [task("a", ADA.id), task("b", GRACE.id), task("c", null)];
const items = cardItems(readCardView(null, [ASSIGNEE], null), [ASSIGNEE]);

describe("a person who left", () => {
  it("keeps their name on the card, marked as gone", () => {
    const card = buildCard(items, task("b", GRACE.id), [ADA], [GRACE]);
    const chip = [...card.footerL, ...card.footerR, ...card.headerL, ...card.headerR].find(
      (c) => c.person,
    );
    expect(chip?.person).toMatchObject({ id: GRACE.id, gone: true });
    expect(chip?.tip).toBe("Assignee · Grace (left)");
  });

  it("is named on a filter chip, and Unassigned leaves their tasks out", () => {
    const rule = { propertyId: ASSIGNEE.id, op: "is" as const, values: [GRACE.id] };
    expect(describeRule(rule, ASSIGNEE, [ADA], [GRACE])).toBe("Assignee is Grace (left)");
    const theirs = applyFilters(
      TASKS,
      { rules: [rule] },
      [ASSIGNEE],
      "2026-10-07",
      null,
      new Set(),
      "UTC",
    );
    expect(theirs.map((t) => t.id)).toEqual(["b"]);
  });

  it("gets a column after the members and before Unassigned, and the filter agrees", () => {
    const columns = buildColumns(ASSIGNEE, TASKS, [ADA], [GRACE]);
    expect(columns.map((c) => c.name)).toEqual(["Ada", "Grace (left)", "Unassigned"]);
    expect(columns[1]).toMatchObject({ gone: true, value: GRACE.id });
    const none = columns.find((c) => c.id === NO_VALUE)!;
    const unassigned = applyFilters(
      TASKS,
      { rules: [{ propertyId: ASSIGNEE.id, op: "is", values: ["__none__"] }] },
      [ASSIGNEE],
      "2026-10-07",
      null,
      new Set(),
      "UTC",
    );
    expect(none.tasks.map((t) => t.id)).toEqual(unassigned.map((t) => t.id));
  });

  it("gets no column once they hold no task", () => {
    const columns = buildColumns(ASSIGNEE, [task("a", ADA.id)], [ADA], [GRACE]);
    expect(columns.map((c) => c.name)).toEqual(["Ada"]);
  });

  it("is never handed a new task by a filter", () => {
    const rule = { propertyId: ASSIGNEE.id, op: "is" as const, values: [GRACE.id] };
    expect(seedValues({ rules: [rule] }, [ASSIGNEE], null, null, "2026-10-07", [GRACE])).toEqual(
      {},
    );
  });

  it("sorts by the name the chip shows", () => {
    const column = items.find((i) => i.id === ASSIGNEE.id)!;
    const sorted = sortTasks(
      TASKS,
      { columnId: column.id, direction: "asc" },
      items,
      [ADA],
      [GRACE],
    );
    expect(sorted.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("reads as a member again after rejoining", () => {
    const back: MemberDTO = { ...ADA, id: GRACE.id, name: "Grace", role: "member" };
    expect(personOf(GRACE.id, [ADA, back], [GRACE])?.gone).toBe(false);
    expect(keyName(GRACE.id, ASSIGNEE, [ADA, back], [GRACE])).toBe("Grace");
    const columns = buildColumns(ASSIGNEE, TASKS, [ADA, back], [GRACE]);
    expect(columns.map((c) => c.name)).toEqual(["Ada", "Grace", "Unassigned"]);
    expect(columns[1].gone).toBeUndefined();
  });
});
