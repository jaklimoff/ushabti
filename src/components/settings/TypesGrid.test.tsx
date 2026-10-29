import { describe, expect, test, vi } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { BoardShell } from "@/components/board/BoardApp";
import { readDefaults, readTypeBy, startsWith, withWhen } from "@/lib/when";
import {
  NO_VALUE_KEY,
  type BoardData,
  type PropertyDTO,
  type PropertyType,
  type TaskDTO,
  type TaskValue,
  type When,
} from "@/lib/types";
import { newProject, propertyOf, renderWithBoard, withTask, type Sent } from "@/test/board";
import { PropertiesPanel } from "./PropertiesPanel";

/*
 * The types grid on the property that holds the types. What the server keeps
 * of a rule or a default is `types-route.test.ts`; this file says what the
 * grid draws and sends.
 */

const PROPERTY = /^\/api\/properties\/[0-9a-f-]+$/;
const PROJECT = /^\/api\/projects\/[0-9a-f-]+$/;
const TASKS = /^\/api\/projects\/[0-9a-f-]+\/tasks$/;

let made = 0;
const id = () => `00000000-0000-4000-8000-0000000d${String(++made).padStart(4, "0")}`;

function add(data: BoardData, name: string, type: PropertyType, options: string[] = []) {
  const property: PropertyDTO = {
    id: id(),
    name,
    type,
    position: `b${String(data.properties.length).padStart(7, "0")}`,
    config: {},
    options: options.map((o, i) => ({
      id: id(),
      name: o,
      color: "#9aa0aa",
      position: `a000000${i}`,
      startAt: null,
      targetAt: null,
      shippedAt: null,
      note: null,
    })),
  };
  data.properties.push(property);
  return property;
}

const optionId = (p: PropertyDTO, name: string) => p.options.find((o) => o.name === name)!.id;

/** Types Bug and Story, where Severity shows only on a Bug and starts Minor. */
function typed() {
  const data = newProject();
  const type = add(data, "Type", "select", ["Bug", "Story"]);
  const severity = add(data, "Severity", "select", ["Minor", "Major"]);
  data.project.typeBy = type.id;
  const bug = optionId(type, "Bug");
  const story = optionId(type, "Story");
  severity.config = {
    when: { propertyId: type.id, optionIds: [bug] },
    defaults: { [bug]: optionId(severity, "Minor") },
  };
  return { data, type, severity, bug, story };
}

/** The server as the grid reads it: a Type, a rule, a default and a count,
    and a create that writes a type's defaults as the route does. */
function serving(data: BoardData) {
  const server = structuredClone(data);
  let number = 900;
  const hides = (rule: When | null, t: TaskDTO) => {
    if (rule === null) return false;
    const value = t.values[rule.propertyId];
    return !rule.optionIds.includes(typeof value === "string" ? value : NO_VALUE_KEY);
  };
  return ({ method, path, query, body }: Sent) => {
    if (method === "GET" && (path.endsWith("/board") || path.endsWith("/settings")))
      return { body: structuredClone(server) };
    if (method === "PATCH" && PROJECT.test(path)) {
      Object.assign(server.project, body as object);
      return { body: { project: server.project } };
    }
    const property = server.properties.find((p) => path.startsWith(`/api/properties/${p.id}`));
    if (method === "PATCH" && property && PROPERTY.test(path)) {
      const sent = body as { when?: When | null; defaults?: Record<string, TaskValue | null> };
      if ("when" in sent) property.config = withWhen(property, sent.when ?? null);
      if (sent.defaults) {
        const defaults = { ...property.config.defaults } as Record<string, TaskValue>;
        for (const [k, v] of Object.entries(sent.defaults)) {
          if (v === null) delete defaults[k];
          else defaults[k] = v;
        }
        property.config = { ...property.config, defaults };
      }
      return { body: { property } };
    }
    if (method === "GET" && property && path.endsWith("/count")) {
      const rule = JSON.parse(query.get("when") ?? "null") as When | null;
      const lost = server.tasks.filter((t) => t.values[property.id] != null && hides(rule, t));
      return { body: { tasks: lost.length, names: lost.length ? [property.name] : [] } };
    }
    if (method === "POST" && TASKS.test(path)) {
      const sent = body as { title: string; values?: Record<string, TaskValue> };
      const values = sent.values ?? {};
      const read = readDefaults(server.properties, server.project.typeBy);
      const starts = startsWith(readTypeBy(server.project.typeBy, read), values, read);
      number += 1;
      const task: TaskDTO = {
        id: id(),
        number,
        key: `${server.project.key}-${number}`,
        title: sent.title,
        description: "",
        position: "a0000000",
        createdAt: "2026-10-08T10:00:00.000Z",
        updatedAt: "2026-10-08T10:00:00.000Z",
        archivedAt: null,
        values: { ...starts, ...values },
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        blockedBy: [],
        parts: null,
      };
      server.tasks.unshift(task);
      return { status: 201, body: { task } };
    }
  };
}

const grid = () => page.getByRole("group", { name: "The types" });
const cell = (property: string, type: string) =>
  grid().getByRole("checkbox", { name: `${property} on ${type}`, exact: true });

async function says(locator: Locator, words: string) {
  await expect.poll(() => locator.element().textContent).toContain(words);
}

describe("The types grid", () => {
  test("ticks every property against every type, and unticking asks with the count", async () => {
    const { data, type, bug, story } = typed();
    const priority = propertyOf(data, "Priority");
    const task = withTask(data, "A story", { Priority: "Urgent" });
    task.values[type.id] = story;
    const { sent } = await renderWithBoard(<PropertiesPanel />, data, serving(data));
    const patches = () => sent("PATCH", PROPERTY);

    // One column per type, after "Shows on"; one row per other property, in order.
    const heads = grid().getByRole("columnheader");
    await expect
      .poll(() => heads.elements().map((h) => h.textContent))
      .toEqual(["Shows on", "Bug", "Story"]);
    const rows = grid().getByRole("rowheader");
    expect(rows.elements().map((r) => r.textContent)).toEqual(
      data.properties.filter((p) => p.id !== type.id).map((p) => p.name),
    );

    // No rule is every type; a rule ticks only its types.
    await expect.element(cell("Priority", "Bug")).toBeChecked();
    await expect.element(cell("Priority", "Story")).toBeChecked();
    await expect.element(cell("Severity", "Bug")).toBeChecked();
    await expect.element(cell("Severity", "Story")).not.toBeChecked();
    // The last type of a property is not taken away here.
    await expect.element(cell("Severity", "Bug")).toBeDisabled();

    // Unticking a type that holds values asks first, under the grid.
    await cell("Priority", "Story").click();
    const ask = grid().getByTestId("when-confirm");
    await says(ask, "1 task loses its Priority.");
    expect(patches()).toEqual([]);
    await ask.getByRole("button", { name: "Yes, hide" }).click();
    await expect.poll(() => patches().length).toBe(1);
    expect(patches()[0].path).toBe(`/api/properties/${priority.id}`);
    expect(patches()[0].body).toEqual({
      when: { propertyId: type.id, optionIds: [bug, NO_VALUE_KEY] },
    });
    await expect.element(cell("Priority", "Story")).not.toBeChecked();
    await expect.element(ask).not.toBeInTheDocument();

    // Ticking the last unticked type takes the rule away.
    await cell("Priority", "Story").click();
    await expect.poll(() => patches().length).toBe(2);
    expect(patches()[1].body).toEqual({ when: null });
    await expect.element(cell("Priority", "Story")).toBeChecked();

    // A tick on a type that drops nothing writes without asking.
    await cell("Severity", "Story").click();
    await expect.poll(() => patches().length).toBe(3);
    expect(patches()[2].body).toEqual({ when: null });
  });

  test("a property ruled by another select is one greyed row with no ticks", async () => {
    const { data } = typed();
    const status = propertyOf(data, "Status");
    propertyOf(data, "Priority").config = {
      when: { propertyId: status.id, optionIds: [optionId(status, "Todo")] },
    };
    await renderWithBoard(<PropertiesPanel />, data, serving(data));
    const row = grid()
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: "Priority" }) });
    await says(row, "Shown when Status is Todo");
    expect(row.getByRole("checkbox").elements()).toHaveLength(0);
  });

  test("a ticked cell says what it starts as, and pressing it edits that start", async () => {
    const { data, severity, bug } = typed();
    const { sent } = await renderWithBoard(<PropertiesPanel />, data, serving(data));
    const minor = grid().getByRole("button", { name: "Severity on Bug starts Minor" });
    await says(minor, "starts Minor");
    // A property that cannot start as anything says nothing.
    expect(
      grid()
        .getByRole("button", { name: /^Assignee on Bug starts/ })
        .elements(),
    ).toHaveLength(0);
    await says(
      grid().getByRole("button", { name: "Priority on Story starts empty" }),
      "starts empty",
    );

    await minor.click();
    const starts = grid().getByTestId("types-grid-starts");
    await expect
      .element(starts.getByRole("button", { name: "Minor" }))
      .toHaveAttribute("aria-pressed", "true");
    await starts.getByRole("button", { name: "Major" }).click();
    await expect.poll(() => sent("PATCH", PROPERTY).length).toBe(1);
    expect(sent("PATCH", PROPERTY)[0].path).toBe(`/api/properties/${severity.id}`);
    expect(sent("PATCH", PROPERTY)[0].body).toEqual({
      defaults: { [bug]: optionId(severity, "Major") },
    });
    await says(grid().getByRole("button", { name: /^Severity on Bug starts/ }), "starts Major");
  });

  test("Turn off clears typeBy", async () => {
    const { data } = typed();
    const { sent } = await renderWithBoard(<PropertiesPanel />, data, serving(data));
    await says(grid(), "A task shows the properties its type ticks.");
    await grid().getByRole("button", { name: "Turn off the types" }).click();
    await expect.poll(() => sent("PATCH", PROJECT).length).toBe(1);
    expect(sent("PATCH", PROJECT)[0].body).toEqual({ typeBy: null });
    await expect.element(grid()).not.toBeInTheDocument();
  });

  test("a member reads the grid and changes nothing", async () => {
    const { data } = typed();
    data.project.role = "member";
    await renderWithBoard(<PropertiesPanel />, data, serving(data));
    await expect.element(cell("Priority", "Bug")).toBeDisabled();
    await expect.element(cell("Severity", "Story")).toBeDisabled();
    expect(
      grid()
        .getByRole("button", { name: /^Turn off/ })
        .elements(),
    ).toHaveLength(0);
    await says(grid(), "starts Minor");
    expect(
      grid()
        .getByRole("button", { name: /starts/ })
        .elements(),
    ).toHaveLength(0);
  });
});

describe("A when row on the types property", () => {
  test("says See the types, and the link goes to the types property", async () => {
    const { data, type } = typed();
    await renderWithBoard(<PropertiesPanel />, data, serving(data));
    const link = page.getByRole("link", { name: "See the types" });
    await expect.element(link).toHaveAttribute("href", `#prop-${type.id}`);
  });
});

/*
 * A Starts as box is a settings row that holds words, so a blur saves it and
 * a tab closed on it sends the same save. A closed tab raises pagehide and no
 * blur, which is what this test raises.
 */
describe("A Starts as box in the grid", () => {
  test("saves on blur, and on a tab closed while it has the focus", async () => {
    const { data, bug } = typed();
    const points = add(data, "Points", "number");
    const { sent } = await renderWithBoard(<PropertiesPanel />, data, serving(data));
    await grid().getByRole("button", { name: "Points on Bug starts empty" }).click();
    const box = () => grid().getByTestId("types-grid-starts").getByRole("textbox");
    const patches = () => sent("PATCH", PROPERTY);

    await box().fill("3");
    expect(patches()).toEqual([]);
    (box().element() as HTMLInputElement).blur();
    await expect.poll(() => patches().length).toBe(1);
    expect(patches()[0].path).toBe(`/api/properties/${points.id}`);
    expect(patches()[0].body).toEqual({ defaults: { [bug]: 3 } });

    // The box still has the focus. Closing the tab here is the lost edit.
    await box().fill("5");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await expect.poll(() => patches().length).toBe(2);
    expect(patches()[1].body).toEqual({ defaults: { [bug]: 5 } });
    const leave = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(leave[1]?.[1]?.keepalive).toBe(true);
  });
});

describe("What a new task of a type starts with", () => {
  /* The screen half. That the server writes the default and answers with it
     is `types-route.test.ts`. */
  test("a task made in the Bug column says what it starts with, then carries it", async () => {
    const { data, type, severity } = typed();
    data.views[0].groupById = type.id;
    const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data, serving(data));

    const column = (name: string) =>
      page.getByTestId("column").filter({
        has: page.getByTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
      });
    await column("Bug").getByRole("button", { name: "Add a task to Bug" }).first().click();
    await says(column("Bug"), "starts with Severity Minor");
    await userEvent.keyboard("{Escape}");
    await column("Story").getByRole("button", { name: "Add a task to Story" }).first().click();
    await expect.element(page.getByPlaceholder("What needs doing?")).toBeVisible();
    expect(column("Story").element().textContent).not.toContain("starts with");
    await userEvent.keyboard("{Escape}");

    await column("Bug").getByRole("button", { name: "Add a task to Bug" }).first().click();
    await page.getByPlaceholder("What needs doing?").fill("A crash");
    await userEvent.keyboard("{Enter}");
    const card = page.getByTestId("card").filter({ hasText: "A crash" });
    await expect.element(card).toBeVisible();
    /* This tab hears no bell for its own create, so only the answer of the
       create can put the default on the card it draws. */
    await says(card, "Minor");
    const create = sent("POST", TASKS);
    expect(create).toHaveLength(1);
    expect((create[0].body as { values: Record<string, TaskValue> }).values).not.toHaveProperty(
      severity.id,
    );
  });
});
