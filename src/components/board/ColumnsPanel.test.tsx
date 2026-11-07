import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import type { BoardData, CardView } from "@/lib/types";
import {
  detailOf,
  newProject,
  propertyOf,
  renderWithBoard,
  withTask,
  type Sent,
} from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * The Columns drawer: what a list shows, in what order, and how each column
 * reads. It writes the view's own card, as the Card drawer does on a board,
 * and the widths are the person's lens.
 */

const LIST_ID = "00000000-0000-4000-8000-777777777777";
const CARD_VIEW = /^\/api\/views\/[0-9a-f-]+\/card-view$/;
const LENS = /^\/api\/views\/[0-9a-f-]+\/lens$/;
const PROPERTY = /^\/api\/properties\/[0-9a-f-]+$/;

function withList(data: BoardData, name = "Rows") {
  for (const view of data.views) view.isDefault = false;
  data.views.push({
    ...data.views[0],
    id: LIST_ID,
    name,
    kind: "list",
    position: "z0000000",
    isDefault: true,
  });
  return data.views.at(-1)!;
}

function project() {
  const data = newProject();
  withTask(data, "Wears a priority", { Status: "Todo", Priority: "Urgent" });
  withList(data);
  return data;
}

/* An opened task reads its detail, and an answer with no task in it means
   the task has gone, which closes the panel. So the task is answered as the
   server would answer it. */
function draw(data: BoardData) {
  return renderWithBoard(<BoardShell initialTask={null} />, data, ({ method, path }) => {
    const asked = /^\/api\/tasks\/([0-9a-f-]+)$/.exec(path);
    const task = method === "GET" && asked && data.tasks.find((t) => t.id === asked[1]);
    if (task) return { body: { task: detailOf(task) } };
  });
}

const byTestId = (id: string) => page.getByTestId(id);
const drawer = () => byTestId("columns-panel");
const row = (id: string) => drawer().element().querySelector(`[data-column="${id}"]`);
const rowOf = (id: string) => page.elementLocator(row(id)!);
const tick = (name: string) => drawer().getByRole("checkbox", { name, exact: true });
const lookOf = (name: string) =>
  drawer().getByRole("button", { name: new RegExp(`^${name} reads as`) });
const heading = (name: string) =>
  byTestId("list-head-cell").filter({
    has: byTestId("list-head-name").filter({ hasText: new RegExp(`^${name}$`, "i") }),
  });

async function gone(locator: Locator) {
  await expect.element(locator).not.toBeInTheDocument();
}

/** The element's words hold `text`. `toHaveTextContent` asks for all of them. */
async function says(locator: Locator, text: string) {
  await expect.poll(() => locator.element().textContent ?? "").toContain(text);
}

async function wrote(sent: () => Sent[], count: number) {
  await expect.poll(() => sent().length).toBe(count);
}

async function openDrawer() {
  await byTestId("card-button").click();
  await expect.element(drawer()).toBeVisible();
}

const rowsOf = (sent: Sent) => (sent.body as { cardView: CardView }).cardView.rows;

describe("The Columns drawer", () => {
  test("is what a list opens, where a board opens its card", async () => {
    const data = project();
    await draw(data);

    await says(byTestId("card-button"), "Columns");
    await openDrawer();
    await gone(byTestId("card-panel"));
    await expect.element(drawer().getByRole("heading", { name: "Columns" })).toBeVisible();
    await says(drawer(), "How a row reads on Rows, for everyone on it");

    // The key and the title are always on the list and cannot come off.
    await expect.element(tick("Task ID")).toBeDisabled();
    await expect.element(tick("Title")).toBeDisabled();

    // Escape puts it away.
    await userEvent.keyboard("{Escape}");
    await gone(drawer());
  });

  test("a tick takes a column off the list and puts it back", async () => {
    const data = project();
    const priority = propertyOf(data, "Priority").id;
    const { sent } = await draw(data);
    const writes = () => sent("PATCH", CARD_VIEW);
    await openDrawer();

    await expect.element(heading("Priority")).toBeVisible();
    await expect.element(tick("Priority")).toBeChecked();
    await tick("Priority").click();
    await wrote(writes, 1);
    expect(writes()[0].path).toBe(`/api/views/${LIST_ID}/card-view`);
    expect(rowsOf(writes()[0])[priority].place).toBe("off");
    await gone(heading("Priority"));
    await expect.element(rowOf(priority)).toHaveAttribute("data-off", "true");

    await tick("Priority").click();
    await wrote(writes, 2);
    expect(rowsOf(writes()[1])[priority].place).not.toBe("off");
    await expect.element(heading("Priority")).toBeVisible();
  });

  test("a look is picked from a menu that draws each one, and previewed first", async () => {
    const data = project();
    const priority = propertyOf(data, "Priority").id;
    const { sent } = await draw(data);
    const writes = () => sent("PATCH", CARD_VIEW);
    await openDrawer();

    await lookOf("Priority").click();
    const menu = drawer().getByRole("menu", { name: "How Priority reads" });
    await expect.element(menu).toBeVisible();
    const options = menu.getByRole("menuitemradio");
    await expect
      .poll(() => options.elements().map((e) => e.textContent?.replace(/Urgent/g, "").trim()))
      .toEqual(["✓Dot and name", "Filled", "Name only"]);
    // Each look carries the chip it draws.
    expect(options.elements().every((e) => e.textContent?.includes("Urgent"))).toBe(true);

    // The column the drawer is changing lights its heading on the list.
    await expect
      .element(page.elementLocator(heading("Priority").element().parentElement!))
      .toHaveAttribute("data-lit", "true");

    // A look under the pointer is drawn in the sample, dashed, before it is picked.
    await menu.getByRole("menuitemradio", { name: /Filled/ }).hover();
    await expect.element(byTestId("columns-sample-cell")).toHaveAttribute("data-draft", "true");
    await says(byTestId("columns-note"), "Filled, not saved yet.");
    expect(writes()).toHaveLength(0);

    await menu.getByRole("menuitemradio", { name: /Filled/ }).click();
    await wrote(writes, 1);
    expect(rowsOf(writes()[0])[priority].mode).toBe("fill");
    await gone(menu);
    await expect.element(lookOf("Priority")).toHaveAccessibleName("Priority reads as Filled");
  });

  test("the title reads alone or with its description", async () => {
    const data = project();
    const { sent } = await draw(data);
    const writes = () => sent("PATCH", CARD_VIEW);
    await openDrawer();

    await expect.element(lookOf("Title")).toHaveAccessibleName("Title reads as Title only");
    await lookOf("Title").click();
    await drawer()
      .getByRole("menuitemradio", { name: /With description/ })
      .click();
    await wrote(writes, 1);
    expect(rowsOf(writes()[0])._desc.place).toBe("body");
  });

  test("a hidden column under the pointer says where it would land", async () => {
    const data = project();
    const created = "_created";
    await draw(data);
    await openDrawer();

    await expect.element(rowOf(created)).toHaveAttribute("data-off", "true");
    await rowOf(created).hover();
    await says(byTestId("columns-note"), "Created is hidden. Tick it to show it after");
    await says(rowOf(created), "Tick to show");
  });

  test("the parts of a task stay last and do not move", async () => {
    const data = project();
    await draw(data);
    await openDrawer();

    for (const name of ["Checklist", "Children", "Comments", "Created", "Updated"]) {
      await expect.element(tick(name)).toBeVisible();
      await gone(drawer().getByRole("button", { name: `Move ${name}` }));
    }
    await expect.element(drawer().getByRole("button", { name: "Move Priority" })).toBeVisible();
  });

  test("a grip moves a property by the keyboard, as Settings does", async () => {
    const data = project();
    const priority = propertyOf(data, "Priority").id;
    const assignee = propertyOf(data, "Assignee").id;
    const { sent } = await draw(data);
    await openDrawer();

    const grip = drawer().getByRole("button", { name: "Move Priority" });
    (grip.element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard(" ");
    await wrote(() => sent("PATCH", PROPERTY), 1);
    const move = sent("PATCH", PROPERTY)[0];
    expect(move.path).toBe(`/api/properties/${priority}`);
    expect(move.body).toEqual({ afterId: assignee });
  });

  test("somebody who may not change the structure ticks and picks, but moves nothing", async () => {
    const data = project();
    data.project.mayStructure = false;
    await draw(data);
    await openDrawer();

    await gone(drawer().getByRole("button", { name: "Move Priority" }));
    await says(drawer(), "The order is set in Settings");
    await expect.element(tick("Priority")).toBeEnabled();
    await expect.element(lookOf("Priority")).toBeVisible();
  });

  test("the widths are the person's, and the foot gives them back", async () => {
    const data = project();
    const priority = propertyOf(data, "Priority").id;
    const list = data.views.find((v) => v.id === LIST_ID)!;
    list.lensWidths = { [priority]: 0.2, _title: 0.3 };
    const { sent } = await draw(data);
    const lens = () => sent("PUT", LENS);
    await openDrawer();

    await says(
      byTestId("columns-widths"),
      "Your widths are kept for this list. Nobody else sees them.",
    );
    await drawer().getByRole("button", { name: "Reset my widths" }).click();
    await wrote(lens, 1);
    expect(lens()[0].body).toMatchObject({ widths: {} });
    await says(byTestId("columns-widths"), "Drag the edge of a heading to size a column.");
    await expect.element(drawer().getByRole("button", { name: "Reset my widths" })).toBeDisabled();
  });

  test("a press outside puts it away, and a press on a row opens the task instead", async () => {
    const data = project();
    await draw(data);
    await openDrawer();

    // Inside, a press changes nothing about the drawer.
    await drawer().getByRole("heading", { name: "Columns" }).click();
    await expect.element(drawer()).toBeVisible();

    // Outside, it goes.
    await byTestId("board-crumb").click();
    await gone(drawer());

    // A row is not outside: it opens its task in the drawer's place.
    await openDrawer();
    await byTestId("list-row").filter({ hasText: "Wears a priority" }).click();
    await expect.element(byTestId("task-panel")).toBeVisible();
    await gone(drawer());
    await byTestId("board-crumb").click();
    await gone(byTestId("task-panel"));
  });

  test("a board still opens its card", async () => {
    const data = newProject();
    await draw(data);
    await says(byTestId("card-button"), "Card");
    await byTestId("card-button").click();
    await expect.element(byTestId("card-panel")).toBeVisible();
    await gone(drawer());
  });
});
