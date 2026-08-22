import { expect, test } from "@playwright/test";
import {
  addTask,
  card,
  column,
  createProject,
  propertyBox,
  register,
  saved,
  unique,
} from "./helpers";

test.describe("Custom properties", () => {
  test("create a property, give it options and group a board by it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Custom"));

    await page.goto(`/p/${projectId}/settings`);
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

    await page.goto(`/p/${projectId}/settings`);
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

    await expect(card(page, "Hidden props").locator('[class*="board_prioSquare__"]')).toBeVisible();

    await page.goto(`/p/${projectId}/settings`);
    await saved(page, () =>
      page.getByRole("button", { name: "Hide Priority on the card" }).click(),
    );
    await expect(page.getByRole("button", { name: "Show Priority on the card" })).toBeVisible();

    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Hidden props").locator('[class*="board_prioSquare__"]')).toHaveCount(
      0,
    );
  });

  test("delete a property and its values disappear", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Delete"));
    await addTask(page, "Todo", "Estimate goes away");
    await page.getByRole("button", { name: "XL" }).click();
    await page.getByRole("button", { name: "Close task" }).click();
    await expect(card(page, "Estimate goes away")).toContainText("XL");

    await page.goto(`/p/${projectId}/settings`);
    await saved(page, () =>
      page.getByRole("button", { name: "Delete the property Estimate" }).click(),
    );
    await expect(page.getByLabel("Name of the Estimate property")).toHaveCount(0);

    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Estimate goes away")).not.toContainText("XL");
  });

  test("text, number and checkbox properties keep their value", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Types"));

    await page.goto(`/p/${projectId}/settings`);
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

    const panel = page.locator('[class*="panel_panel__"]');
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
