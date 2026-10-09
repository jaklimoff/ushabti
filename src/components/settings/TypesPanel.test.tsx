import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { BoardShell } from "@/components/board/BoardApp";
import { readDefaults, readTypeBy, startsWith, withWhen } from "@/lib/when";
import type { BoardData, PropertyDTO, PropertyType, TaskDTO, TaskValue, When } from "@/lib/types";
import { ME, newProject, propertyOf, renderWithBoard, withTask, type Sent } from "@/test/board";
import { at } from "@/test/next-navigation";
import { SettingsShell } from "./SettingsShell";
import { TypesPanel } from "./TypesPanel";

/*
 * The Types page, and what a new task of a type starts with. Each test here
 * was a test of `e2e/types.spec.ts` or `e2e/type-defaults.spec.ts`, and its
 * name is the name it had there. Which select may be the Type, what a create
 * writes and what a refused default answers are `types-route.test.ts`.
 */

const PROPERTY = /^\/api\/properties\/[0-9a-f-]+$/;
const PROJECT = /^\/api\/projects\/[0-9a-f-]+$/;
const TASKS = /^\/api\/projects\/[0-9a-f-]+\/tasks$/;

let made = 0;
const id = () => `00000000-0000-4000-8000-0000000c${String(++made).padStart(4, "0")}`;

/** A property of `type` added after the board's own, as the route makes one. */
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

/** A project with a Type select of Bug and Story, not yet named the Type. */
function typed() {
  const data = newProject();
  const type = add(data, "Type", "select", ["Bug", "Story"]);
  return { data, type, bug: optionId(type, "Bug"), story: optionId(type, "Story") };
}

/** Typed by Bug and Story, where a Bug starts with Severity Minor. */
function startsAs() {
  const { data, type, bug, story } = typed();
  const severity = add(data, "Severity", "select", ["Minor", "Major"]);
  add(data, "Owner", "person");
  data.project.typeBy = type.id;
  severity.config = {
    when: { propertyId: type.id, optionIds: [bug] },
    defaults: { [bug]: optionId(severity, "Minor") },
  };
  return {
    data,
    type,
    severity,
    bug,
    story,
    minor: optionId(severity, "Minor"),
    major: optionId(severity, "Major"),
  };
}

/**
 * The server, as far as the Types page reads it: it keeps a Type, a rule and
 * a default it is sent, counts what a rule hides, makes an option, and
 * writes a type's defaults on a create, with the same rules the route reads.
 */
function serving(data: BoardData) {
  const server = structuredClone(data);
  let number = 900;
  const hides = (rule: When | null, t: TaskDTO) =>
    rule !== null && !rule.optionIds.includes(String(t.values[rule.propertyId]));
  const answer = ({ method, path, query, body }: Sent) => {
    if (method === "GET" && (path.endsWith("/board") || path.endsWith("/settings")))
      return { body: structuredClone(server) };
    if (method === "PATCH" && PROJECT.test(path)) {
      Object.assign(server.project, body as object);
      return { body: { project: server.project } };
    }
    const property = server.properties.find((p) => path.startsWith(`/api/properties/${p.id}`));
    if (method === "PATCH" && property && PROPERTY.test(path)) {
      const sent = body as { when?: When | null; defaults?: Record<string, TaskValue> };
      if ("when" in sent) {
        property.config = withWhen(property, sent.when ?? null);
        /* A rule drops the values it hides, as the route does. */
        for (const t of server.tasks) if (hides(sent.when ?? null, t)) delete t.values[property.id];
      }
      if (sent.defaults) {
        const defaults = { ...property.config.defaults };
        for (const [k, v] of Object.entries(sent.defaults)) {
          if (v === null) delete defaults[k];
          else defaults[k] = v;
        }
        property.config = { ...property.config, defaults };
        if (Object.keys(defaults).length === 0) delete property.config.defaults;
      }
      return { body: { property } };
    }
    if (method === "GET" && property && path.endsWith("/count")) {
      const rule = JSON.parse(query.get("when") ?? "null") as When | null;
      const lost = server.tasks.filter((t) => t.values[property.id] != null && hides(rule, t));
      return {
        body: { tasks: lost.length, names: lost.length ? [property.name] : [] },
      };
    }
    if (method === "POST" && property && path.endsWith("/options")) {
      const option = { ...property.options[0], id: id(), name: (body as { name: string }).name };
      option.position = `z${property.options.length}`;
      property.options.push(option);
      return { body: { option } };
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
  return { server, answer };
}

/** Draws Settings → Types as the layout does, with its own loader. */
async function drawTypes(data: BoardData) {
  at.pathname = `/p/${data.project.id}/settings/types`;
  const { server, answer } = serving(data);
  const drawn = await renderWithBoard(
    <SettingsShell initial={data} user={ME} version="0.0.0">
      <TypesPanel />
    </SettingsShell>,
    data,
    answer,
  );
  return { ...drawn, server };
}

/* The words as the DOM holds them. `toHaveTextContent` timed out on some of
   these rows with the words plainly in them, so they are read directly. */
async function says(locator: Locator, words: string) {
  await expect.poll(() => locator.element().textContent).toContain(words);
}

const sheet = () => page.getByTestId("type-sheet");
const typeRow = (name: string) =>
  sheet()
    .getByTestId("type-row")
    .filter({ has: page.getByText(name, { exact: true }) });

async function choose(select: Locator, label: string) {
  await select.click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

afterEach(() => {
  at.pathname = null;
});

describe("The Types page", () => {
  test("an admin picks the Type, opens a type and moves a property on and off it", async () => {
    const { data, type, bug, story } = typed();
    const priority = propertyOf(data, "Priority");
    const task = withTask(data, "A story", { Priority: "Urgent" });
    task.values[type.id] = story;
    const { sent, server } = await drawTypes(data);
    const patches = () => sent("PATCH", PROPERTY);

    const nav = page.getByRole("navigation", { name: "Settings sections" });
    await says(nav.getByRole("link", { name: /^Types/ }), "Types0");
    await choose(page.getByLabelText("Types come from"), "Type");
    expect(sent("PATCH", PROJECT)[0].body).toEqual({ typeBy: type.id });
    const types = page.getByRole("group", { name: "Types" });
    await expect.poll(() => types.getByRole("button").elements().length).toBe(2);
    expect(
      types
        .getByRole("button")
        .elements()
        .map((b) => b.textContent),
    ).toEqual(["Bug", "Story"]);
    await says(nav.getByRole("link", { name: /^Types/ }), "Types2");

    // Bug opens first. Priority is on every type; limiting it asks with the count.
    const row = typeRow("Priority");
    await row.getByRole("button", { name: "Only on Bug" }).click();
    const ask = row.getByTestId("when-confirm");
    await says(ask, "1 task loses its Priority.");
    // The question belongs to Bug: another type drops it, and coming back asks afresh.
    await types.getByRole("button", { name: "Story" }).click();
    await expect.element(row.getByRole("button", { name: "Only on Story" })).toBeVisible();
    await expect.element(ask).not.toBeInTheDocument();
    await types.getByRole("button", { name: "Bug" }).click();
    await row.getByRole("button", { name: "Only on Bug" }).click();
    await says(ask, "1 task loses its Priority.");
    expect(patches()).toEqual([]);
    await ask.getByRole("button", { name: "Yes, hide" }).click();
    await says(row, "Only on Bug. Change it on the Properties page.");
    expect(row.getByTestId("type-act").getByRole("button").elements()).toHaveLength(0);
    expect(patches()[0].path).toBe(`/api/properties/${priority.id}`);
    expect(patches()[0].body).toEqual({ when: { propertyId: type.id, optionIds: [bug] } });

    // On Story it is on another type, and adding it hides nothing, so nothing asks.
    await types.getByRole("button", { name: "Story" }).click();
    await says(row, "on Bug");
    await row.getByRole("button", { name: "Add to Story" }).click();
    await says(row, "also on Bug");
    await expect.poll(() => patches().length).toBe(2);
    expect(patches()[1].body).toEqual({
      when: { propertyId: type.id, optionIds: [bug, story] },
    });

    await row.getByRole("button", { name: "Take off Story" }).click();
    await expect.poll(() => patches().length).toBe(3);
    expect(patches()[2].body).toEqual({ when: { propertyId: type.id, optionIds: [bug] } });
    await expect.element(row.getByRole("button", { name: "Add to Story" })).toBeVisible();

    // A new type is a new option of the select.
    await page.getByLabelText("New type name").fill("Chore");
    await page.getByRole("button", { name: "Add type" }).click();
    await expect.poll(() => types.getByRole("button").elements().length).toBe(3);
    expect(
      types
        .getByRole("button")
        .elements()
        .map((b) => b.textContent),
    ).toEqual(["Bug", "Story", "Chore"]);
    const options = sent("POST", /\/options$/);
    expect(options).toHaveLength(1);
    expect(options[0].path).toBe(`/api/properties/${type.id}/options`);
    expect(options[0].body).toMatchObject({ name: "Chore" });
    expect(server.properties.find((p) => p.id === type.id)!.options.map((o) => o.name)).toEqual([
      "Bug",
      "Story",
      "Chore",
    ]);
  });

  test("a property ruled by another select reads its rule and cannot be changed here", async () => {
    const { data, type } = typed();
    const status = propertyOf(data, "Status");
    propertyOf(data, "Priority").config = {
      when: { propertyId: status.id, optionIds: [optionId(status, "Todo")] },
    };
    data.project.typeBy = type.id;
    await drawTypes(data);

    const row = typeRow("Priority");
    await says(row, "Shown when Status is Todo");
    expect(row.getByTestId("type-act").getByRole("button").elements()).toHaveLength(0);
  });

  test("with no Type, the page says what a type is and offers the selects", async () => {
    const { data } = typed();
    await drawTypes(data);
    await expect.element(page.getByText(/A type is an option of one select/)).toBeVisible();
    const picker = page.getByLabelText("Types come from");
    await expect.element(picker).toHaveAttribute("data-value", "");
    /* In this order, with the board's other selects between them. */
    await picker.click();
    const named = ["No select", "Status", "Priority", "Type"];
    const offered = page
      .getByRole("option")
      .elements()
      .map((o) => o.textContent!.replace("✓", "").trim());
    expect(offered.filter((word) => named.includes(word))).toEqual(named);
    await userEvent.keyboard("{Escape}");
    expect(sheet().elements()).toHaveLength(0);
  });
});

describe("What a new task of a type starts with", () => {
  /* The screen half of the same e2e test. That the server writes the default
     and answers with it is `types-route.test.ts`. */
  test("a task made in the Bug column says what it starts with, then carries it", async () => {
    const { data, type, severity } = startsAs();
    data.views[0].groupById = type.id;
    const { answer } = serving(data);
    const { sent } = await renderWithBoard(<BoardShell initialTask={null} />, data, answer);

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

  test("an admin sets what a type starts as on the Types page", async () => {
    const { data, severity, bug, major } = startsAs();
    const { sent } = await drawTypes(data);
    const starts = typeRow("Severity").getByTestId("starts-as");
    await says(starts, "Starts as");
    await expect
      .element(starts.getByRole("button", { name: "Minor" }))
      .toHaveAttribute("aria-pressed", "true");

    await starts.getByRole("button", { name: "Major" }).click();
    await expect.poll(() => sent("PATCH", PROPERTY).length).toBe(1);
    expect(sent("PATCH", PROPERTY)[0].path).toBe(`/api/properties/${severity.id}`);
    expect(sent("PATCH", PROPERTY)[0].body).toEqual({ defaults: { [bug]: major } });
    await expect
      .element(starts.getByRole("button", { name: "Major" }))
      .toHaveAttribute("aria-pressed", "true");
    // A person has no Starts as.
    expect(typeRow("Owner").getByTestId("starts-as").elements()).toHaveLength(0);
  });
});

/*
 * A number or text box on the Types page is a settings row that holds words,
 * so a blur saves it and a tab closed on it sends the same save. A closed tab
 * raises pagehide and no blur, which is what these tests raise. That the
 * server keeps and clears the default is `types-route.test.ts`.
 */
describe("A Starts as box", () => {
  test("saves on blur, and on a tab closed while it has the focus", async () => {
    const { data, bug } = startsAs();
    const points = add(data, "Points", "number");
    const drawn = await drawTypes(data);
    const box = () => typeRow("Points").getByTestId("starts-as").getByRole("textbox");
    const patches = () => drawn.sent("PATCH", PROPERTY);

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

    // An emptied box owes a clear, and a closed tab sends it too. The next
    // page reads what the server kept.
    await drawn.screen.unmount();
    const again = await drawTypes(drawn.server);
    await expect.element(box()).toHaveValue("5");
    await box().fill("");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await expect.poll(() => again.sent("PATCH", PROPERTY).length).toBe(1);
    expect(again.sent("PATCH", PROPERTY)[0].body).toEqual({ defaults: { [bug]: null } });
  });
});
