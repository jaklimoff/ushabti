import { afterEach, describe, expect, test } from "vitest";
import { page, type Locator } from "vitest/browser";
import { BoardShell } from "@/components/board/BoardApp";
import { withWhen } from "@/lib/when";
import type { BoardData, When } from "@/lib/types";
import {
  detailOf,
  newProject,
  propertyOf,
  renderWithBoard,
  withTask,
  type Answer,
} from "@/test/board";
import { PropertiesPanel } from "./PropertiesPanel";

/*
 * The rule "shown when", on screen. Each test here was a test of
 * `e2e/when.spec.ts`, and its name is the name it had there. Who may set it,
 * what a bad rule answers and what the server keeps is `when-route.test.ts`.
 * "Two rules written at once cannot close a circle" stayed end to end: only a
 * real server can run the two writes at once.
 */

const PROPERTY = /^\/api\/properties\/[0-9a-f-]+$/;
const byTestId = (id: string) => page.getByTestId(id);

/** A project with a Type select of Bug and Story. */
function typed() {
  const data = newProject();
  const type = {
    ...propertyOf(data, "Priority"),
    id: "00000000-0000-4000-8000-00000000a001",
    name: "Type",
    position: "a0000099",
    options: ["Bug", "Story"].map((name, i) => ({
      ...propertyOf(data, "Priority").options[0],
      id: `00000000-0000-4000-8000-00000000b00${i}`,
      name,
      position: `a000000${i}`,
    })),
  };
  data.properties.push(type);
  return { data, type };
}

/* The server counts what a rule would hide, and these tests hide nothing. It
   keeps a rule it is sent, so a read of the board that follows still has it. */
function serving(data: BoardData): Answer {
  const server = structuredClone(data);
  return ({ method, path, body }) => {
    if (method === "GET" && path.endsWith("/board")) return { body: server };
    if (method === "PATCH" && PROPERTY.test(path)) {
      const when = (body as { when: When | null }).when;
      const property = server.properties.find((p) => path.endsWith(p.id))!;
      property.config = withWhen(property, when);
      return;
    }
    if (method === "GET" && /\/count$/.test(path)) return { body: { tasks: 0, names: [] } };
    const asked = /^\/api\/tasks\/([0-9a-f-]+)$/.exec(path);
    if (method === "GET" && asked) {
      const task = data.tasks.find((t) => t.id === asked[1]);
      if (task) return { body: { task: detailOf(task) } };
    }
  };
}

const propertyBox = (name: string) =>
  byTestId("property-box").filter({ has: page.getByLabelText(`Name of the ${name} property`) });

async function chooseIn(select: Locator, label: string) {
  await select.click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

/* How close the nearest drawn thing comes to the box's left or right edge.
   Only what draws counts: an element with no element inside it, or with words. */
function edgeRoom(root: Element): number {
  const edge = root.getBoundingClientRect();
  let left = Infinity;
  let right = Infinity;
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    const words = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "",
    );
    if (el.children.length > 0 && !words) continue;
    left = Math.min(left, r.left - edge.left);
    right = Math.min(right, edge.right - r.right);
  }
  return Math.min(left, right);
}

async function openRule(box: Locator) {
  await box.getByRole("button", { name: "Shown when…" }).click();
  await chooseIn(box.getByLabelText("Shown when of Priority"), "Type");
}

describe("A property says when it shows", () => {
  test("it is in the panel, on the card and in the list for a Bug, and absent for a Story", async () => {
    const { data, type } = typed();
    const priority = propertyOf(data, "Priority");
    const bug = type.options[0].id;
    const story = type.options[1].id;
    for (const [title, kind] of [
      ["A bug", bug],
      ["A story", story],
    ]) {
      const task = withTask(data, title, { Status: "Todo", Priority: "Urgent" });
      task.values[type.id] = kind;
    }
    priority.config = { when: { propertyId: type.id, optionIds: [bug] } };
    data.views.push({
      ...data.views[0],
      id: "00000000-0000-4000-8000-777777777777",
      name: "Rows",
      kind: "list",
      position: "z0000000",
      isDefault: false,
    });
    await renderWithBoard(<BoardShell initialTask={null} />, data, serving(data));

    const card = (title: string) =>
      byTestId("board-canvas").getByTestId("card").filter({ hasText: title });
    const chip = '[data-testid="card-chip"][title="Priority · Urgent"]';
    await expect.poll(() => card("A bug").element().querySelector(chip)).not.toBeNull();
    await expect.element(card("A story")).toBeVisible();
    expect(card("A story").element().querySelector(chip)).toBeNull();

    const field = (name: string) => document.querySelector(`[data-property="${name}"]`);
    await card("A bug").click();
    await expect.element(byTestId("task-panel")).toBeVisible();
    await expect.poll(() => field("Priority")).not.toBeNull();
    expect(field("Type")).not.toBeNull();
    await page.getByRole("button", { name: "Close task" }).click();
    await card("A story").click();
    await expect.poll(() => field("Type")).not.toBeNull();
    expect(field("Priority")).toBeNull();
    await page.getByRole("button", { name: "Close task" }).click();

    await byTestId("view-pill").filter({ hasText: "Rows" }).click();
    const row = (title: string) => byTestId("list-row").filter({ hasText: title });
    await expect.element(byTestId("list-view")).toBeVisible();
    await expect.element(row("A bug").getByText("Urgent")).toBeVisible();
    await expect.element(row("A story")).toBeVisible();
    expect(row("A story").element().textContent).not.toContain("Urgent");
  });

  test("Settings says the rule in words and clears it with one press", async () => {
    const { data, type } = typed();
    const priority = propertyOf(data, "Priority");
    const bug = type.options[0].id;
    const story = type.options[1].id;
    const { sent } = await renderWithBoard(<PropertiesPanel />, data, serving(data));
    const box = propertyBox("Priority");
    const bugBox = box.getByLabelText("Bug", { exact: true });
    const storyBox = box.getByLabelText("Story", { exact: true });

    await box.getByRole("button", { name: "Shown when…" }).click();
    // Picking a select asks the question; it writes nothing yet.
    await chooseIn(box.getByLabelText("Shown when of Priority"), "Type");
    expect(sent("PATCH", PROPERTY)).toEqual([]);

    await bugBox.click();
    await expect.element(bugBox).toBeChecked();
    await expect.poll(() => sent("PATCH", PROPERTY).length).toBe(1);
    await storyBox.click();
    await expect
      .element(box.getByTestId("when-said"))
      .toHaveTextContent("Shown when Type is Bug or Story");
    await expect.poll(() => sent("PATCH", PROPERTY).length).toBe(2);
    expect(sent("PATCH", PROPERTY)[1].path).toBe(`/api/properties/${priority.id}`);
    // What the server keeps of it is the route's to say.
    expect(sent("PATCH", PROPERTY)[1].body).toEqual({
      when: { propertyId: type.id, optionIds: [bug, story] },
    });

    await propertyBox("Priority").getByRole("button", { name: "Always show Priority" }).click();
    await expect.poll(() => sent("PATCH", PROPERTY).length).toBe(3);
    expect(sent("PATCH", PROPERTY)[2].body).toEqual({ when: null });
    await expect.element(box.getByTestId("when-said")).not.toBeInTheDocument();
    await expect.element(box.getByRole("button", { name: "Shown when…" })).toBeVisible();
  });

  /* A failed test must not leave the next one at phone width. */
  afterEach(() => page.viewport(1440, 900));

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`the rule's line keeps off the card edge at ${width} px`, async () => {
      await page.viewport(width, height);
      const { data } = typed();
      await renderWithBoard(<PropertiesPanel />, data, serving(data));
      const box = propertyBox("Priority");
      await openRule(box);
      await expect.element(box.getByLabelText("Bug", { exact: true })).toBeVisible();
      await expect.poll(() => edgeRoom(box.element())).toBeGreaterThanOrEqual(12);
    });
  }

  test("the rule's line starts where the property's name does", async () => {
    const { data } = typed();
    await renderWithBoard(<PropertiesPanel />, data, serving(data));
    const box = propertyBox("Priority");
    await box.getByRole("button", { name: "Shown when…" }).click();
    // The name box draws its words inside its own padding.
    const fromName = () => {
      const input = box
        .element()
        .querySelector<HTMLElement>('input[aria-label^="Name of the "][aria-label$=" property"]')!;
      const style = getComputedStyle(input);
      const start =
        input.getBoundingClientRect().left +
        parseFloat(style.paddingLeft) +
        parseFloat(style.borderLeftWidth);
      return Math.abs(byTestId("when-said").element().getBoundingClientRect().x - start);
    };
    await expect.poll(fromName).toBeLessThanOrEqual(3);
  });
});
