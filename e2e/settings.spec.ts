import { expect, test } from "@playwright/test";
import { column, createProject, gotoSettings, register, saved, unique } from "./helpers";

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

    await saved(page, () =>
      page.getByRole("button", { name: "Make Phases the main view" }).click(),
    );

    // One view is main, so the word moved rather than spread.
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Make Phases the main view" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete the view Board" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete the view Phases" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toBeVisible();

    // Nobody has picked a view in this browser, so the board opens on the main
    // one: the Phase columns, and not the Status ones.
    await page.goto(`/p/${projectId}`);
    await expect(column(page, "PoC")).toBeVisible();
  });
});
