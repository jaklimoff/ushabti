import { describe, expect, test } from "vitest";
import { page, type Locator } from "vitest/browser";
import { withWhen } from "@/lib/when";
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

/** The server as the grid reads it: a Type, a rule, a default and a count. */
function serving(data: BoardData) {
  const server = structuredClone(data);
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

  test("the switch off clears typeBy", async () => {
    const { data } = typed();
    const { sent } = await renderWithBoard(<PropertiesPanel />, data, serving(data));
    await says(grid(), "A task shows the properties its type ticks.");
    await grid().getByRole("switch", { name: "Each option is a type" }).click();
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
    expect(grid().getByRole("switch").elements()).toHaveLength(0);
    await says(grid(), "starts Minor");
    expect(
      grid()
        .getByRole("button", { name: /starts/ })
        .elements(),
    ).toHaveLength(0);
  });
});
