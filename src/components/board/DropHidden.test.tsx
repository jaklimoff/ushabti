import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { PropertiesPanel } from "@/components/settings/PropertiesPanel";
import type { ActivityDTO, BoardData, When } from "@/lib/types";
import {
  newProject,
  propertyOf,
  renderWithBoard,
  withTask,
  type Answer,
  type Sent,
} from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * What the panel, the bar and Settings ask before a value is dropped. Each
 * test here was a test of `e2e/drop-hidden.spec.ts`, and its name is the name
 * it had there. What the server drops and answers is
 * `drop-hidden-route.test.ts`; the sums behind the questions are
 * `when-drop.test.ts`. "A rule written in Settings asks with the count, then
 * drops" is split: the question and the write are here, the drop is the
 * route's. Priority stands in for Severity, as it did there.
 */

const WRITE =
  /^\/api\/(tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+|projects\/[0-9a-f-]+\/tasks\/values)$/;
const PROPERTY = /^\/api\/properties\/[0-9a-f-]+$/;
const TASK = /^\/api\/tasks\/[0-9a-f-]+$/;

const byTestId = (id: string) => page.getByTestId(id);
const card = (title: string) => byTestId("card").filter({ hasText: title });
const chip = '[data-testid="card-chip"][title="Priority · Urgent"]';
const field = (name: string) =>
  document.querySelector(`[data-testid="task-panel"] [data-property="${name}"]`);

/**
 * A Type select of Bug and Story, Priority shown only for a Bug, and
 * `titles` as bugs with an Urgent priority.
 */
function bugs(titles: string[], rule = true) {
  const data = newProject();
  const priority = propertyOf(data, "Priority");
  const type = {
    ...priority,
    id: "00000000-0000-4000-8000-00000000a001",
    name: "Type",
    position: "a0000099",
    options: ["Bug", "Story"].map((name, i) => ({
      ...priority.options[0],
      id: `00000000-0000-4000-8000-00000000b00${i}`,
      name,
      position: `a000000${i}`,
    })),
    config: {},
  };
  data.properties.push(type);
  const bug = type.options[0].id;
  for (const title of titles) {
    const task = withTask(data, title, { Status: "Todo", Priority: "Urgent" });
    task.values[type.id] = bug;
  }
  if (rule) priority.config = { when: { propertyId: type.id, optionIds: [bug] } };
  return { data, type, priority, bug };
}

async function draw(data: BoardData, open: string | null, wrap?: (base: Answer) => Answer) {
  const server = serving(data);
  const answer = wrap ? wrap(server.answer) : server.answer;
  const drawn = await renderWithBoard(<BoardShell initialTask={open} />, data, answer);
  const writes = () => drawn.sent().filter((r) => r.method !== "GET" && WRITE.test(r.path));
  return { ...drawn, server: server.server, writes };
}

/** The element's words hold `text`. `toHaveTextContent` asks for all of them. */
async function says(locator: Locator, text: string) {
  await expect.poll(() => locator.element().textContent ?? "").toContain(text);
}

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

describe("A value its task does not show is dropped", () => {
  test("the panel asks with the names; Cancel writes nothing and Yes drops", async () => {
    const { data, type } = bugs(["First bug"]);
    const { writes, server } = await draw(data, data.tasks[0].key);
    const panel = byTestId("task-panel");
    await expect.poll(() => field("Priority")).not.toBeNull();
    const typeRow = () => page.elementLocator(field("Type")!);

    await typeRow().getByRole("button", { name: "Story" }).click();
    const ask = panel.getByTestId("value-confirm");
    await says(ask, "Change Type to Story? Priority loses its value.");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await gone(ask);
    expect(writes()).toEqual([]);
    expect(field("Priority")).not.toBeNull();

    await typeRow().getByRole("button", { name: "Story" }).click();
    await ask.getByRole("button", { name: "Yes, change" }).click();
    await expect.poll(() => writes().length).toBe(1);
    expect(writes()[0].body).toEqual({ value: type.options[1].id });
    await expect.poll(() => field("Priority")).toBeNull();
    await gone(card("First bug").getByTestId("card-chip").filter({ hasText: "Urgent" }));
    expect(card("First bug").element().querySelector(chip)).toBeNull();
    expect(server.tasks[0].values[type.id]).toBe(type.options[1].id);

    /* Back to Bug hides nothing, so it asks nothing. */
    await typeRow().getByRole("button", { name: "Bug" }).click();
    await expect.poll(() => writes().length).toBe(2);
    await gone(ask);
  });

  test("the panel's own write shows its lines in Activity at once", async () => {
    const { data, type } = bugs(["First bug"]);
    const mine: ActivityDTO[] = [];
    const line = (kind: string, d: Record<string, unknown>) =>
      mine.unshift({
        id: `00000000-0000-4000-9000-${String(900 + mine.length).padStart(12, "0")}`,
        kind,
        data: d,
        createdAt: new Date().toISOString(),
        actor: { id: "me", name: "Ada", color: "#888888", emoji: null, kind: "human" },
      } as ActivityDTO);
    /* The server writes the lines of a write, and the panel reads them back. */
    const wrap = (base: Answer): Answer => {
      return (sent: Sent) => {
        if (sent.method === "PUT" && WRITE.test(sent.path)) {
          line("value", { property: "Type", type: "select", value: "Story" });
          line("value", { dropped: ["Priority"], hidBy: "Story" });
        }
        if (sent.method === "PATCH" && TASK.test(sent.path))
          line("title", { title: (sent.body as { title: string }).title });
        const said = base(sent);
        if (sent.method === "GET" && TASK.test(sent.path) && said?.body)
          (said.body as { task: { activity: ActivityDTO[] } }).task.activity = [...mine];
        return said;
      };
    };
    const { server } = await draw(data, data.tasks[0].key, wrap);
    const panel = byTestId("task-panel");
    await expect.poll(() => field("Priority")).not.toBeNull();
    await panel.getByRole("tab", { name: /^Activity/ }).click();

    await page.elementLocator(field("Type")!).getByRole("button", { name: "Story" }).click();
    await panel.getByTestId("value-confirm").getByRole("button", { name: "Yes, change" }).click();
    /* No reopen: the write itself reads the task again. */
    await expect.element(panel.getByText("set Type to Story")).toBeVisible();
    await expect
      .element(panel.getByText("Story hid Priority, and its value was dropped"))
      .toBeVisible();
    /* The value just picked holds. */
    expect(field("Priority")).toBeNull();
    expect(server.tasks[0].values[type.id]).toBe(type.options[1].id);

    /* A title already read its line; this keeps it so. */
    await panel.getByTestId("task-title").fill("Renamed bug");
    await panel.getByTestId("task-title").element().blur();
    await expect.element(panel.getByText("renamed it to “Renamed bug”")).toBeVisible();
  });

  test("bulk Set asks first with the counts", async () => {
    const { data, type } = bugs(["First bug", "Second bug"]);
    const { writes, server } = await draw(data, null);
    for (const title of ["First bug", "Second bug"])
      await card(title).getByTestId("card-pick").click();
    const search = byTestId("pick-search");
    const choose = async () => {
      await byTestId("pick-set").click();
      await search.fill("Type");
      await userEvent.keyboard("{Enter}");
      await byTestId("pick-menu").getByRole("button", { name: "Story" }).click();
    };
    await choose();
    await says(
      byTestId("pick-set-confirm"),
      "Set Type to Story on 2 tasks? 2 values go (Priority).",
    );
    await byTestId("pick-set-no").click();
    expect(writes()).toEqual([]);

    await choose();
    await byTestId("pick-set-yes").click();
    await expect.poll(() => writes().length).toBe(1);
    expect(writes()[0].body).toMatchObject({ propertyId: type.id, value: type.options[1].id });
    await expect.poll(() => card("Second bug").element().querySelector(chip)).toBeNull();
    expect(card("First bug").element().querySelector(chip)).toBeNull();
    expect(server.tasks.every((t) => t.values[type.id] === type.options[1].id)).toBe(true);
  });

  test("the bulk question goes when the picks change under it", async () => {
    const { data } = bugs(["First bug", "Second bug"]);
    withTask(data, "Third", { Status: "Todo" });
    const { writes } = await draw(data, null);
    for (const title of ["First bug", "Second bug"])
      await card(title).getByTestId("card-pick").click();
    await byTestId("pick-set").click();
    const search = byTestId("pick-search");
    await search.fill("Type");
    await userEvent.keyboard("{Enter}");
    await byTestId("pick-menu").getByRole("button", { name: "Story" }).click();
    await says(byTestId("pick-set-confirm"), "on 2 tasks?");

    /* Yes would set the picks of the click, which the question did not count. */
    await card("Third").getByTestId("card-pick").click();
    await gone(byTestId("pick-set-confirm"));
    await says(byTestId("pick-count"), "3 selected");
    expect(writes()).toEqual([]);
  });
});

describe("A rule in Settings", () => {
  /* The server's rules are what Settings reads after a write. */
  function settings(
    data: BoardData,
    count = { tasks: 0, names: [] as string[] },
    stored: Record<string, When> = {},
  ): Answer {
    const server = structuredClone(data);
    return ({ method, path, body }) => {
      if (method === "GET" && path.endsWith("/board")) return { body: server };
      if (method === "GET" && /\/count$/.test(path)) return { body: count };
      if (method === "PATCH" && PROPERTY.test(path)) {
        const property = server.properties.find((p) => path.endsWith(p.id))!;
        const when = (body as { when?: unknown }).when;
        /* The rules a circle switched off come back when the write frees them. */
        for (const [id, rule] of Object.entries(stored)) {
          const held = server.properties.find((p) => p.id === id)!;
          held.config = { ...held.config, when: rule };
        }
        if (when !== undefined)
          property.config = { ...property.config, when: when ?? undefined } as never;
      }
      return undefined;
    };
  }
  const propertyBox = (name: string) =>
    byTestId("property-box").filter({ has: page.getByLabelText(`Name of the ${name} property`) });
  async function chooseIn(select: Locator, label: string) {
    await select.click();
    await page.getByRole("option", { name: label, exact: true }).click();
  }

  test("a rule that breaks a circle in Settings shows the rules it frees at once", async () => {
    const data = newProject();
    const base = propertyOf(data, "Priority");
    const make = (name: string, n: number, options: string[]) => {
      const p = {
        ...base,
        id: `00000000-0000-4000-8000-00000000c00${n}`,
        name,
        position: `a00000${90 + n}`,
        config: {},
        options: options.map((o, i) => ({
          ...base.options[0],
          id: `00000000-0000-4000-8000-00000000d${n}${i}0`,
          name: o,
          position: `a000000${i}`,
        })),
      };
      data.properties.push(p);
      return p;
    };
    const [type, area, size] = [
      make("Type", 1, ["Bug", "Story"]),
      make("Area", 2, ["Front", "Back"]),
      make("Size", 3, ["Big", "Small"]),
    ];
    /* The server reads a circle as no rules at all, so the board it sends has
       none; the rules it keeps come back once a write frees them. */
    const stored = {
      [area.id]: { propertyId: type.id, optionIds: [type.options[0].id] },
      [type.id]: { propertyId: size.id, optionIds: [size.options[1].id] },
    };
    const { sent } = await renderWithBoard(
      <PropertiesPanel />,
      data,
      settings(data, { tasks: 0, names: [] }, stored),
    );
    /* Every rule of the circle reads as none, here as on the board. */
    await expect.element(propertyBox("Size")).toBeVisible();
    for (const name of ["Type", "Area", "Size"])
      await gone(propertyBox(name).getByTestId("when-said"));

    /* Size shown when Priority is Urgent breaks the circle, and frees the
       rules of Type and Area. */
    const box = propertyBox("Size");
    await box.getByRole("button", { name: "Shown when…" }).click();
    await chooseIn(box.getByLabelText("Shown when of Size"), "Priority");
    await box.getByLabelText("Urgent", { exact: true }).click();
    await expect.poll(() => sent("PATCH", PROPERTY).length).toBe(1);
    await says(propertyBox("Size").getByTestId("when-said"), "Shown when Priority is Urgent");
    await says(propertyBox("Type").getByTestId("when-said"), "Shown when Size is Small");
    await says(propertyBox("Area").getByTestId("when-said"), "Shown when Type is Bug");
  });

  test("a rule written in Settings asks with the count, then drops", async () => {
    const { data, type, priority, bug } = bugs(["First bug", "Second bug"], false);
    data.tasks[0].values[type.id] = type.options[1].id;
    const { sent } = await renderWithBoard(
      <PropertiesPanel />,
      data,
      settings(data, { tasks: 1, names: ["Priority"] }),
    );
    const box = propertyBox("Priority");
    await box.getByRole("button", { name: "Shown when…" }).click();
    await chooseIn(box.getByLabelText("Shown when of Priority"), "Type");
    await box.getByLabelText("Bug", { exact: true }).click();
    const ask = box.getByTestId("when-confirm");
    await says(ask, "1 task loses its Priority.");
    await ask.getByRole("button", { name: "Cancel" }).click();
    expect(sent("PATCH", PROPERTY)).toEqual([]);

    await box.getByLabelText("Bug", { exact: true }).click();
    await ask.getByRole("button", { name: "Yes, hide" }).click();
    await expect.poll(() => sent("PATCH", PROPERTY).length).toBe(1);
    expect(sent("PATCH", PROPERTY)[0].path).toBe(`/api/properties/${priority.id}`);
    expect(sent("PATCH", PROPERTY)[0].body).toEqual({
      when: { propertyId: type.id, optionIds: [bug] },
    });
    await says(box.getByTestId("when-said"), "Shown when Type is Bug");
  });
});
