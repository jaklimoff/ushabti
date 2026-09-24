import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addTask,
  card,
  column,
  columnOrder,
  confirmDelete,
  createProject,
  dragOnto,
  gotoSettings,
  propertyBox,
  propertyRowOrder,
  register,
  saved,
  sortBoard,
  unique,
} from "./helpers";

/** The options of one property in Settings, in the order the chips sit. */
async function optionOrder(box: Locator): Promise<string[]> {
  return box
    .locator('input[aria-label^="Name of the option "]')
    .evaluateAll((boxes) => boxes.map((b) => (b as HTMLInputElement).value));
}

/** The names of the board's columns, left to right. */
async function columnNames(page: Page): Promise<string[]> {
  return (await page.getByTestId("column-name").allInnerTexts()).map((t) => t.trim().toUpperCase());
}

test.describe("Custom properties", () => {
  test("create a property, give it options and group a board by it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Custom"));

    await gotoSettings(page, projectId);
    await page.getByLabel("New property name").fill("Risk");
    await page.getByPlaceholder("Options, separated by commas").fill("Low, Medium, High");
    await page.getByRole("button", { name: "Add property" }).click();

    const risk = propertyBox(page, "Risk");
    await expect(risk.getByLabel("Name of the Risk property")).toHaveValue("Risk");
    await expect(risk.getByLabel("Name of the option Medium")).toHaveValue("Medium");

    await page.goto(`/p/${projectId}`);
    await page.getByRole("button", { name: "New view" }).click();
    await page.getByPlaceholder("View name").fill("By risk");
    await page.getByRole("button", { name: "Risk", exact: true }).click();
    await page.getByRole("button", { name: "Create view" }).click();

    for (const name of ["Low", "Medium", "High"]) {
      await expect(column(page, name)).toBeVisible();
    }
  });

  test("rename an option and the column follows", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Rename"));

    await gotoSettings(page, projectId);
    const status = propertyBox(page, "Status");
    const backlog = status.getByLabel("Name of the option Backlog");
    await backlog.fill("Icebox");
    await saved(page, () => backlog.blur());

    await page.goto(`/p/${projectId}`);
    await expect(column(page, "Icebox")).toBeVisible();
    await expect(column(page, "Backlog")).toHaveCount(0);
  });

  test("hide a property and it leaves the card", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Hide"));
    await addTask(page, "Todo", "Hidden props");
    await page.getByRole("button", { name: "Urgent" }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await expect(card(page, "Hidden props").locator('[title="Priority · Urgent"]')).toBeVisible();

    await gotoSettings(page, projectId, "card");
    await page.getByRole("button", { name: /^Priority on the card/ }).click();
    await saved(page, () => page.getByRole("button", { name: "Take off the card" }).click());

    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Hidden props").locator('[title="Priority · Urgent"]')).toHaveCount(0);
  });

  test("showOnCard on the API still takes a property off the card and back", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Api"));
    await addTask(page, "Todo", "Chip by API");
    await page.getByRole("button", { name: "Urgent" }).click();
    await page.getByRole("button", { name: "Close task" }).click();
    const chip = card(page, "Chip by API").locator('[title="Priority · Urgent"]');
    await expect(chip).toBeVisible();

    const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const priority = board.properties.find((p: { name: string }) => p.name === "Priority");
    const patch = (showOnCard: boolean) =>
      page.request.patch(`/api/properties/${priority.id}`, { data: { showOnCard } });

    expect((await patch(false)).ok()).toBe(true);
    await page.reload();
    await expect(chip).toHaveCount(0);

    expect((await patch(true)).ok()).toBe(true);
    await page.reload();
    await expect(chip).toBeVisible();
  });

  test("delete a property and its values disappear", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Delete"));
    await addTask(page, "Todo", "Estimate goes away");
    await page.getByRole("button", { name: "XL" }).click();
    await page.getByRole("button", { name: "Close task" }).click();
    await expect(card(page, "Estimate goes away")).toContainText("XL");

    await gotoSettings(page, projectId);

    // It asks first, and it says what goes with it.
    await page.getByRole("button", { name: "Delete the property Estimate" }).click();
    await expect(page.getByText(/Delete Estimate\? .* go with it\./)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Name of the Estimate property")).toBeVisible();

    await page.getByRole("button", { name: "Delete the property Estimate" }).click();
    await saved(page, () => confirmDelete(page));
    await expect(page.getByLabel("Name of the Estimate property")).toHaveCount(0);

    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Estimate goes away")).not.toContainText("XL");
  });

  test("a property is dragged into its place, and stays there", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("PropOrder"));

    await gotoSettings(page, projectId);
    expect((await propertyRowOrder(page)).slice(0, 2)).toEqual(["Status", "Priority"]);

    await dragOnto(
      page,
      page.getByRole("button", { name: "Move Priority" }),
      page.getByLabel("Name of the Status property"),
      /^\/api\/properties\/[0-9a-f-]+$/,
    );
    expect((await propertyRowOrder(page)).slice(0, 2)).toEqual(["Priority", "Status"]);

    // The order is the server's, so it survives the page going away.
    await page.reload();
    expect((await propertyRowOrder(page)).slice(0, 2)).toEqual(["Priority", "Status"]);
  });

  test("the keyboard moves a property as well as the pointer", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("PropKeys"));

    await gotoSettings(page, projectId);
    await page.getByRole("button", { name: "Move Status" }).focus();

    // Space lifts the row, the arrows move it, Space puts it down.
    await page.keyboard.press("Space");
    // dnd-kit measures the rows after the lift, so the first arrow needs the
    // frame that comes with it.
    await page.waitForTimeout(120);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(120);
    await page.keyboard.press("Space");

    await expect
      .poll(async () => (await propertyRowOrder(page)).slice(0, 2))
      .toEqual(["Priority", "Status"]);
  });

  test("an option is dragged into its place, and the sort follows it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("OptOrder"));
    for (const [title, priority] of [
      ["Aardvark", "Low"],
      ["Beetle", "Urgent"],
    ] as const) {
      await addTask(page, "Todo", title);
      await page.getByRole("button", { name: priority, exact: true }).click();
      await page.getByRole("button", { name: "Close task" }).click();
    }
    await sortBoard(page, "Priority");
    expect(await columnOrder(page, "Todo")).toEqual(["Beetle", "Aardvark"]);

    await gotoSettings(page, projectId);
    const priority = propertyBox(page, "Priority");
    expect(await optionOrder(priority)).toEqual(["Urgent", "High", "Medium", "Low"]);

    await dragOnto(
      page,
      priority.getByRole("button", { name: "Reorder the option Low" }),
      priority.getByLabel("Name of the option Urgent"),
      /^\/api\/options\/[0-9a-f-]+$/,
    );
    expect(await optionOrder(priority)).toEqual(["Low", "Urgent", "High", "Medium"]);

    // The order is the server's, so it survives the page going away.
    await page.reload();
    expect(await optionOrder(propertyBox(page, "Priority"))).toEqual([
      "Low",
      "Urgent",
      "High",
      "Medium",
    ]);

    // A select sorts by its option order, so Low now comes first.
    await page.goto(`/p/${projectId}`);
    await expect.poll(() => columnOrder(page, "Todo")).toEqual(["Aardvark", "Beetle"]);
  });

  test("the keyboard moves an option, and the columns follow it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("OptKeys"));
    expect((await columnNames(page)).slice(0, 2)).toEqual(["BACKLOG", "TODO"]);

    await gotoSettings(page, projectId);
    const status = propertyBox(page, "Status");
    await status.getByRole("button", { name: "Reorder the option Backlog" }).focus();

    // Space lifts the chip, the arrows move it, Space puts it down.
    await page.keyboard.press("Space");
    await page.waitForTimeout(120);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
    await page.keyboard.press("Space");

    await expect
      .poll(async () => (await optionOrder(status)).slice(0, 2))
      .toEqual(["Todo", "Backlog"]);

    await page.goto(`/p/${projectId}`);
    await expect
      .poll(async () => (await columnNames(page)).slice(0, 2))
      .toEqual(["TODO", "BACKLOG"]);
  });

  test("text, number and checkbox properties keep their value", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Types"));

    await gotoSettings(page, projectId);
    for (const [name, type] of [
      ["Owner note", "Text"],
      ["Points", "Number"],
      ["Blocked", "Checkbox"],
    ] as const) {
      await page.getByLabel("New property name").fill(name);
      await page.getByLabel("Type of the new property").selectOption({ label: type });
      await page.getByRole("button", { name: "Add property" }).click();
      await expect(page.getByLabel(`Name of the ${name} property`)).toBeVisible();
    }

    await page.goto(`/p/${projectId}`);
    await addTask(page, "Todo", "All the types");

    const panel = page.getByTestId("task-panel");
    const scalars = panel.getByPlaceholder("Empty");
    await scalars.nth(0).fill("Ask Ada");
    await saved(page, () => scalars.nth(0).press("Enter"));
    await scalars.nth(1).fill("8");
    await saved(page, () => scalars.nth(1).press("Enter"));
    await saved(page, () => panel.getByRole("switch").click());
    await expect(panel.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    await page.goto(`/p/${projectId}`);
    await card(page, "All the types").click();
    await expect(panel.getByPlaceholder("Empty").nth(0)).toHaveValue("Ask Ada");
    await expect(panel.getByPlaceholder("Empty").nth(1)).toHaveValue("8");
    await expect(panel.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});
