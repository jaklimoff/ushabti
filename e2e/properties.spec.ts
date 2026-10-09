import { expect, test } from "@playwright/test";
import {
  column,
  createProject,
  gotoSettings,
  propertyBox,
  register,
  saved,
  unique,
} from "./helpers";

/* The other tests of this spec run as component and route tests, in
   `PropertiesPanel.test.tsx` and `properties-route.test.ts`. */

test.describe("Custom properties", () => {
  test(
    "create a property, give it options and group a board by it",
    { tag: "@smoke" },
    async ({ page }) => {
      await register(page);
      const projectId = await createProject(page, unique("Custom"));

      await gotoSettings(page, projectId);
      await page.getByLabel("New property name").fill("Risk");
      await page.getByLabel("Options of the new property").fill("Low\nMedium\nHigh");
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
    },
  );

  test("rename an option and the column follows", { tag: "@smoke" }, async ({ page }) => {
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
});
