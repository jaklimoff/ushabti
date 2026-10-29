import { expect, test } from "@playwright/test";
import {
  addFilter,
  addTask,
  card,
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
 * and the two counts are `properties-route.test.ts`. These need a second
 * browser, a reload or a real rename.
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
    await expect(summaries.nth(0)).toHaveText("Default card·1 filter");
    await expect(summaries.nth(1)).toHaveText("Default card·no filters");

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

  test("a new project key asks before it renames the tasks", async ({ page }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("KeyAsk"));
    await addTask(page, "Todo", "Named after the key");
    await addTask(page, "Todo", "Also named after it");

    await gotoSettings(page, projectId, "project");
    const box = page.getByLabel("Project key", { exact: true });
    await hydrated(box);
    const old = await box.inputValue();
    const next = old === "ZZQ" ? "ZZR" : "ZZQ";

    await box.fill(next);
    await expect(page.getByText(/Leaving this box asks before it renames them/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-key-typing.png"), fullPage: true });

    // A stray Tab asks, and the focus waits on the way back.
    let patched = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH" && /\/api\/projects\/[0-9a-f-]+$/.test(r.url())) patched++;
    });
    await box.press("Tab");
    const ask = page.getByRole("alertdialog");
    await expect(ask).toHaveAccessibleName(
      `Rename 2 tasks from ${old}- to ${next}-? Links and agent instructions that use the old key stop working.`,
    );
    await expect(page.getByRole("button", { name: "Put it back" })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("seen-key-confirm.png"), fullPage: true });

    await page.getByRole("button", { name: "Put it back" }).click();
    await expect(box).toHaveValue(old);
    expect(patched).toBe(0);

    await box.fill(next);
    await box.press("Tab");
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "PATCH" && /\/api\/projects\/[0-9a-f-]+$/.test(r.url()),
      ),
      page.getByRole("button", { name: "Yes, rename" }).click(),
    ]);
    await expect(box).toHaveValue(next);

    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Named after the key").first()).toContainText(`${next}-`);
  });
});
