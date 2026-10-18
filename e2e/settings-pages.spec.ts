import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, propertyBox, register, unique } from "./helpers";

/*
 * The settings pages as a person sees them after the design pass: a grouped
 * menu, Project in named cards, People rows that fit a phone, property blocks
 * that say what uses them, and a card view row that rings its part of the
 * preview. The rules themselves are the panel tests; this keeps the pages in
 * front of a reviewer.
 */
test.describe("Settings pages", () => {
  test("the menu groups the pages, and Project reads as named cards", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Pages"));

    await gotoSettings(page, projectId, "project");
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    for (const group of ["General", "Board", "Integrations"]) {
      await expect(rail.getByRole("group", { name: group })).toBeVisible();
    }
    // A new project has no types, and none reads as nothing.
    await expect(rail.getByRole("link", { name: "Types", exact: true })).toBeVisible();
    for (const title of ["General", "Work", "Agents", "Export", "Danger zone"]) {
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "Delete project" }).click();
    await expect(page.getByRole("button", { name: "Delete for good" })).toBeDisabled();
    await expect(page.getByLabel("Type the project key to confirm")).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("seen-project.png"), fullPage: true });
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("a property says what uses it, and a card view row rings the card", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Uses"));

    await gotoSettings(page, projectId, "properties");
    await expect(propertyBox(page, "Status").getByTestId("property-use")).toHaveText(
      "Columns of Board",
    );
    await expect(page.getByText(/groupable/i)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("seen-properties.png"), fullPage: true });

    await gotoSettings(page, projectId, "card");
    const row = page
      .getByTestId("card-row")
      .filter({ has: page.getByRole("button", { name: /^Priority on the card/ }) });
    await row.hover();
    const preview = page.getByRole("complementary", { name: "What a card looks like" });
    await expect(preview.locator("[data-lit]").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-card-view.png") });
  });

  test("on a phone the People rows keep their role and their button", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page);
    const projectId = await createProject(page, unique("Phone"));

    await gotoSettings(page, projectId, "people");
    const role = page.getByText("Owner", { exact: true }).first();
    await expect(role).toBeInViewport();
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(width).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath("seen-people-phone.png"), fullPage: true });
  });
});
