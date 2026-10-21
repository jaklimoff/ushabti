import { expect, test } from "@playwright/test";
import {
  addFilter,
  column,
  createProject,
  gotoSettings,
  hydrated,
  putFilterOnView,
  register,
  saved,
  unique,
} from "./helpers";

/*
 * The rest of this file went down in USH-274: the Settings pages are
 * `ViewsPanel.test.tsx`, `ProjectPanel.test.tsx`, `PropertiesPanel.test.tsx`
 * and `SettingsShell.test.tsx`, the empty board's hint is `Board.test.tsx`,
 * and the two counts are `properties-route.test.ts`. These two need a second
 * browser or a reload.
 */
test.describe("Settings", () => {
  test("another view is made the main one, and the board opens on it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("MainView"));

    await gotoSettings(page, projectId, "views");
    // The main view carries the word and cannot be deleted; the other one
    // carries the way to take the word from it.
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete the view Board" })).toHaveCount(0);

    await saved(page, () => page.getByRole("button", { name: "Make List the main view" }).click());

    // One view is main, so the word moved rather than spread.
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Make List the main view" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete the view Board" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete the view List" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toBeVisible();

    // Nobody has picked a view in this browser, so the board opens on the main
    // one: the list, and not the Status columns.
    await page.goto(`/p/${projectId}`);
    await expect(page.getByTestId("list-view")).toBeVisible();
    await expect(column(page, "Todo")).toHaveCount(0);
  });

  test("a view row says its card and its filters, and opens on both", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("ViewRows"));
    await addFilter(page, "Priority", "Urgent");
    await putFilterOnView(page);

    await gotoSettings(page, projectId, "views");
    await hydrated(page.getByLabel("Name of the view Board"));
    const summaries = page.getByTestId("view-summary");
    await expect(summaries.nth(0)).toHaveText("default card1 filter for everyone");
    await expect(summaries.nth(1)).toHaveText("default cardno filters");

    await summaries.nth(0).click();
    await expect(page.getByRole("button", { name: "Close the view Board" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const open = page.getByTestId("view-open");
    await expect(open.getByTestId("filter-chip-read")).toHaveText(/Priority/);
    await expect(open.getByRole("link", { name: "Change them on the board" })).toHaveAttribute(
      "href",
      new RegExp(`/p/${projectId}\\?view=[0-9a-f-]+$`),
    );
    await expect(open.getByTestId("view-fork")).toContainText("Board follows the default card");
    await expect(open.getByRole("group", { name: "Arrange the card as" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-view-row-open.png"), fullPage: true });
  });
});
