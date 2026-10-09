import { afterEach, describe, expect, test } from "vitest";
import { commands, page, userEvent, type Locator } from "vitest/browser";
import { BoardShell } from "@/components/board/BoardApp";
import type { BoardData } from "@/lib/types";
import {
  newProject,
  propertyOf,
  renderWithBoard,
  withTask,
  type Answer,
  type Sent,
} from "@/test/board";
import { serving as servingPanel } from "@/test/panel";
import { CardViewPanel } from "./CardViewPanel";
import { PropertiesPanel } from "./PropertiesPanel";

/*
 * The Properties page, and the board that draws what it says. Each test here
 * was a test of `e2e/properties.spec.ts`, and its name is the name it had
 * there. A test that reloaded only to find what was saved is two halves: this
 * file says what was sent, and `properties-route.test.ts` says what was kept.
 * The two @smoke tests, making a property and grouping a board by it, and
 * renaming an option, stayed end to end.
 */

const PROPERTY = /^\/api\/properties\/[0-9a-f-]+$/;
const OPTION = /^\/api\/options\/[0-9a-f-]+$/;
const PROJECT_CARD = /^\/api\/projects\/[0-9a-f-]+\/card-view$/;

const byTestId = (id: string) => page.getByTestId(id);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* A keyboard drag waits for the lift and for the move, not for a fixed time
   alone: a slow runner took longer than 120 ms to lift (CI, 2026-10-09). The
   short pause is the frame in which dnd-kit measures the rows after the lift,
   which nothing on the page says. */
async function keyboardDrag(grip: Locator, arrow: string) {
  await userEvent.keyboard(" ");
  await expect.element(grip).toHaveAttribute("aria-pressed", "true");
  await pause(50);
  const before = (grip.element() as HTMLElement).getBoundingClientRect();
  await userEvent.keyboard(arrow);
  await expect
    .poll(() => {
      const now = (grip.element() as HTMLElement).getBoundingClientRect();
      return Math.abs(now.x - before.x) + Math.abs(now.y - before.y);
    })
    .toBeGreaterThan(8);
  await userEvent.keyboard(" ");
}
const box = (locator: Locator) => locator.element().getBoundingClientRect();

/** The box of one property on the page. */
const propertyBox = (name: string) =>
  byTestId("property-box").filter({ has: page.getByLabelText(`Name of the ${name} property`) });

const card = (title: string) =>
  byTestId("board-canvas").getByTestId("card").filter({ hasText: title });

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

async function wrote(sent: () => Sent[], count: number) {
  await expect.poll(() => sent().length).toBe(count);
}

/** The words of every property name box, top to bottom. */
const propertyOrder = () =>
  (page.getByLabelText(/ property$/).elements() as HTMLInputElement[]).map((b) => b.value);

/** The words of every option name box of one property, in the order the chips sit. */
const optionOrder = (property: Locator) =>
  Array.from(
    property
      .element()
      .querySelectorAll<HTMLInputElement>('input[aria-label^="Name of the option "]'),
  ).map((b) => b.value);

/** The names of the board's columns, left to right. */
const columnNames = () =>
  byTestId("column-name")
    .elements()
    .map((el) => el.textContent?.trim().toUpperCase() ?? "");

/** The titles of one column's cards, top to bottom. */
const columnOrder = (name: string) =>
  byTestId("column")
    .filter({
      has: byTestId("column-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
    })
    .getByTestId("card-title")
    .elements()
    .map((el) => el.textContent?.trim() ?? "");

const choose = async (select: Locator, label: string) => {
  const list = select.element().getAttribute("aria-controls");
  await select.click();
  await page
    .elementLocator(document.getElementById(list!)!)
    .getByRole("option", { name: label, exact: true })
    .click();
};

/** How far the nearest words in the box sit from its left and right edge. */
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
  if (left === Infinity) throw new Error("The card draws nothing");
  return Math.min(left, right);
}

/** The settings page above the board, both drawing from the one store. */
/* A moved option is read back with the board right after the move. A server
   that answered with the old order would put it back, and under load that read
   lands before the test looks (CI, 2026-10-09). So the move is kept here, as
   the route keeps it. */
function keepsOptionMoves(data: BoardData): Answer {
  return ({ method, path, body }) => {
    const { afterId } = (body ?? {}) as { afterId?: string | null };
    if (method !== "PATCH" || !OPTION.test(path) || afterId === undefined) return undefined;
    const id = path.split("/").pop();
    data.properties = data.properties.map((p) => {
      const moved = p.options.find((o) => o.id === id);
      if (!moved) return p;
      const rest = p.options.filter((o) => o !== moved);
      rest.splice(afterId === null ? 0 : rest.findIndex((o) => o.id === afterId) + 1, 0, moved);
      return { ...p, options: rest };
    });
    return undefined;
  };
}

async function draw(data: BoardData, settings = <PropertiesPanel />, answer?: Answer) {
  return renderWithBoard(
    <>
      {settings}
      <BoardShell initialTask={null} />
    </>,
    data,
    answer,
  );
}

describe("Custom properties", () => {
  // A phone test must not leave the next one at phone width.
  afterEach(() => page.viewport(1440, 900));

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`a property row keeps its tools together and off the card edge at ${width} px`, async () => {
      await page.viewport(width, height);
      await renderWithBoard(<PropertiesPanel />, newProject());
      const status = propertyBox("Status");
      const tools = status.getByTestId("property-tools");
      /* No switch for dates: Use releases and Use sprints say that now. */
      await gone(tools.getByLabelText("Options carry dates"));
      const when = tools.getByRole("button", { name: "Shown when…" });
      await expect.element(when).toBeVisible();
      await expect
        .element(tools.getByRole("button", { name: "Delete the property Status" }))
        .toBeVisible();

      await expect.poll(() => edgeRoom(status.element())).toBeGreaterThanOrEqual(12);

      /* Shown when is a button: it has a box, and a ring when the keys reach it. */
      expect(box(when).height).toBeGreaterThanOrEqual(24);
      (when.element() as HTMLElement).focus();
      await userEvent.tab({ shift: true });
      await userEvent.tab();
      await expect.element(when).toHaveFocus();
      expect(getComputedStyle(when.element()).outlineStyle).toBe("solid");

      /* The option ✕ is big enough to see, in the icon colour. */
      const remove = status.getByRole("button", { name: "Delete the option Backlog" });
      expect(box(remove).width).toBeGreaterThanOrEqual(18);
      const probe = document.createElement("span");
      document.body.append(probe);
      probe.style.color = "var(--icon)";
      const icon = getComputedStyle(probe).color;
      probe.style.color = "var(--danger-soft)";
      const danger = getComputedStyle(probe).color;
      probe.remove();
      expect(getComputedStyle(remove.element()).color).toBe(icon);
      expect(parseFloat(getComputedStyle(remove.element()).fontSize)).toBeGreaterThanOrEqual(12);
      await remove.hover();
      await expect.poll(() => getComputedStyle(remove.element()).color).toBe(danger);
    });
  }

  test("a member's row on a phone draws no empty tools line", async () => {
    await page.viewport(390, 844);
    const data = newProject();
    data.project.role = "member";
    await renderWithBoard(<PropertiesPanel />, data);
    const assignee = propertyBox("Assignee");
    await expect.element(assignee).toBeVisible();
    /* Under the tags sits only the head's own 11 px, and no gap for a line
       that holds nothing. */
    const tools = assignee.getByTestId("property-tools").element();
    const head = tools.parentElement!;
    const tags = tools.previousElementSibling!;
    const under = head.getBoundingClientRect().bottom - tags.getBoundingClientRect().bottom;
    expect(under).toBeLessThanOrEqual(12);
  });

  test("hide a property and it leaves the card", async () => {
    const data = newProject();
    withTask(data, "Hidden props", { Status: "Todo", Priority: "Urgent" });
    const { sent } = await draw(data, <CardViewPanel />);

    const chip = card("Hidden props").getByTitle("Priority · Urgent");
    await expect.element(chip).toBeVisible();

    await page.getByRole("button", { name: /^Priority on the card/ }).click();
    await page.getByRole("button", { name: "Take off the card" }).click();
    await wrote(() => sent("PATCH", PROJECT_CARD), 1);
    const priority = propertyOf(data, "Priority");
    expect(
      (
        sent("PATCH", PROJECT_CARD)[0].body as {
          cardView: { rows: Record<string, { place: string }> };
        }
      ).cardView.rows[priority.id].place,
    ).toBe("off");
    await gone(chip);
  });

  test("delete a property and its values disappear", async () => {
    const data = newProject();
    withTask(data, "Estimate goes away", { Status: "Todo", Estimate: "XL" });
    const estimate = propertyOf(data, "Estimate");
    // The server's board, which loses the property when the delete lands.
    const server = structuredClone(data);
    const answer: Answer = ({ method, path }) => {
      if (method === "GET" && path === `/api/properties/${estimate.id}/count`) {
        return { body: { values: 1 } };
      }
      if (method === "DELETE" && path === `/api/properties/${estimate.id}`) {
        server.properties = server.properties.filter((p) => p.id !== estimate.id);
        for (const t of server.tasks) delete t.values[estimate.id];
        return { body: { ok: true } };
      }
      if (method === "GET" && path.endsWith("/board")) return { body: server };
    };
    const { sent } = await draw(data, <PropertiesPanel />, answer);
    await expect.poll(() => card("Estimate goes away").element().textContent).toContain("XL");

    // It asks first, and it says what goes with it.
    await page.getByRole("button", { name: "Delete the property Estimate" }).click();
    await expect.element(page.getByText(/Delete Estimate\? .* go with it\./)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(page.getByLabelText("Name of the Estimate property")).toBeVisible();
    expect(sent("DELETE")).toEqual([]);

    await page.getByRole("button", { name: "Delete the property Estimate" }).click();
    await page.getByRole("button", { name: /^Yes, delete/ }).click();
    await wrote(() => sent("DELETE", PROPERTY), 1);
    await gone(page.getByLabelText("Name of the Estimate property"));
    await expect.poll(() => card("Estimate goes away").element().textContent).not.toContain("XL");
  });

  test("a property is dragged into its place, and stays there", async () => {
    const data = newProject();
    const { sent } = await renderWithBoard(<PropertiesPanel />, data);
    expect(propertyOrder().slice(0, 2)).toEqual(["Status", "Priority"]);

    const from = box(page.getByRole("button", { name: "Move Priority" }));
    const to = box(page.getByLabelText("Name of the Status property"));
    await commands.drag(
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: to.x + to.width / 2, y: to.y + to.height / 2 },
    );
    await wrote(() => sent("PATCH", PROPERTY), 1);
    expect(propertyOrder().slice(0, 2)).toEqual(["Priority", "Status"]);
    // Dropped on the first row, it lands after nothing.
    expect(sent("PATCH", PROPERTY)[0].path).toBe(
      `/api/properties/${propertyOf(data, "Priority").id}`,
    );
    expect(sent("PATCH", PROPERTY)[0].body).toEqual({ afterId: null });
  });

  test("the keyboard moves a property as well as the pointer", async () => {
    const data = newProject();
    const { sent } = await renderWithBoard(<PropertiesPanel />, data);
    const grip = page.getByRole("button", { name: "Move Status" });
    (grip.element() as HTMLElement).focus();

    // Space lifts the row, the arrows move it, Space puts it down.
    await keyboardDrag(grip, "{ArrowDown}");

    await expect.poll(() => propertyOrder().slice(0, 2)).toEqual(["Priority", "Status"]);
    await wrote(() => sent("PATCH", PROPERTY), 1);
    expect(sent("PATCH", PROPERTY)[0].body).toEqual({ afterId: propertyOf(data, "Priority").id });
  });

  test("an option is dragged into its place, and the sort follows it", async () => {
    const data = newProject();
    withTask(data, "Aardvark", { Status: "Todo", Priority: "Low" });
    withTask(data, "Beetle", { Status: "Todo", Priority: "Urgent" });
    const priority = propertyOf(data, "Priority");
    data.views[0].sort = { columnId: priority.id, direction: "asc" };
    const { sent } = await draw(data, undefined, keepsOptionMoves(data));
    await expect.poll(() => columnOrder("Todo")).toEqual(["Beetle", "Aardvark"]);

    const prop = propertyBox("Priority");
    expect(optionOrder(prop)).toEqual(["Urgent", "High", "Medium", "Low"]);

    const from = box(prop.getByRole("button", { name: "Move the option Low" }));
    const to = box(prop.getByLabelText("Name of the option Urgent"));
    await commands.drag(
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: to.x + to.width / 2, y: to.y + to.height / 2 },
    );
    await wrote(() => sent("PATCH", OPTION), 1);
    expect(optionOrder(prop)).toEqual(["Low", "Urgent", "High", "Medium"]);
    expect(sent("PATCH", OPTION)[0].body).toEqual({ afterId: null });

    // A select sorts by its option order, so Low now comes first.
    await expect.poll(() => columnOrder("Todo")).toEqual(["Aardvark", "Beetle"]);
  });

  test("the keyboard moves an option, and the columns follow it", async () => {
    const data = newProject();
    const { sent } = await draw(data, undefined, keepsOptionMoves(data));
    await expect.poll(() => columnNames().slice(0, 2)).toEqual(["BACKLOG", "TODO"]);

    const todo = propertyOf(data, "Status").options[1].id;
    const status = propertyBox("Status");
    const grip = status.getByRole("button", { name: "Move the option Backlog" });
    (grip.element() as HTMLElement).focus();

    /* Space lifts the option, the arrows move it, Space puts it down. Status
       carries no dates, so its options sit in a row and move right. */
    await keyboardDrag(grip, "{ArrowRight}");

    await expect.poll(() => optionOrder(status).slice(0, 2)).toEqual(["Todo", "Backlog"]);
    await wrote(() => sent("PATCH", OPTION), 1);
    expect(sent("PATCH", OPTION)[0].body).toEqual({ afterId: todo });
    await expect.poll(() => columnNames().slice(0, 2)).toEqual(["TODO", "BACKLOG"]);
  });

  test("text, number and checkbox properties keep their value", async () => {
    // Making them: the page sends the type each was given.
    const made = await renderWithBoard(<PropertiesPanel />, newProject());
    for (const [name, type] of [
      ["Owner note", "Text"],
      ["Points", "Number"],
      ["Blocked", "Checkbox"],
    ] as const) {
      await page.getByLabelText("New property name").fill(name);
      await choose(page.getByLabelText("Type of the new property"), type);
      await page.getByRole("button", { name: "Add property" }).click();
    }
    const POSTS = /^\/api\/projects\/[0-9a-f-]+\/properties$/;
    await wrote(() => made.sent("POST", POSTS), 3);
    expect(made.sent("POST", POSTS).map((s) => s.body)).toEqual([
      { name: "Owner note", type: "text" },
      { name: "Points", type: "number" },
      { name: "Blocked", type: "checkbox" },
    ]);
    await made.screen.unmount();

    // Filling them in on a task: the panel sends each value as typed.
    const data = newProject();
    for (const [name, type] of [
      ["Owner note", "text"],
      ["Points", "number"],
      ["Blocked", "checkbox"],
    ] as const) {
      data.properties.push({
        id: `00000000-0000-4000-8000-9${String(data.properties.length).padStart(11, "0")}`,
        name,
        type,
        position: `b000000${data.properties.length}`,
        config: {},
        options: [],
      });
    }
    const task = withTask(data, "All the types", { Status: "Todo" });
    const { sent } = await renderWithBoard(
      <BoardShell initialTask={task.key} />,
      data,
      servingPanel(data).answer,
    );

    const panel = byTestId("task-panel");
    // An empty field says what a column says: "No points", not "Empty".
    const note = panel.getByPlaceholder("No owner note");
    const points = panel.getByPlaceholder("No points");
    await note.fill("Ask Ada");
    await userEvent.keyboard("{Enter}");
    await points.fill("8");
    await userEvent.keyboard("{Enter}");
    await panel.getByRole("switch").click();
    await expect.element(panel.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    const VALUE = /^\/api\/tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+$/;
    await wrote(() => sent("PUT", VALUE), 3);
    expect(sent("PUT", VALUE).map((s) => (s.body as { value: unknown }).value)).toEqual([
      "Ask Ada",
      8,
      true,
    ]);
  });
});
