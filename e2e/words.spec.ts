import { expect, test, type Page } from "@playwright/test";
import { addTask, card, createProject, register, unique } from "./helpers";

/*
 * One idea, one word. A new team reads these in its first hour, and a second
 * word for the same thing reads as a second thing.
 */

/** The browser says it runs on `platform`, before any page script reads it. */
async function onPlatform(page: Page, platform: string) {
  await page.addInitScript((value) => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => value });
  }, platform);
}

test.describe("One word for each idea", () => {
  test("an empty field, the selection and the archive each have one word", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Words"));
    await addTask(page, "Todo", "Wordy");

    // An empty field says what a column and a filter chip say.
    const panel = page.getByTestId("task-panel");
    await expect(panel.getByRole("button", { name: "Due No due", exact: true })).toBeVisible();
    await expect(panel.getByText("Empty", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Close task" }).click();

    // The check selects; the ✕ clears the selection.
    const check = card(page, "Wordy").getByTestId("card-pick");
    await expect(check).toHaveAccessibleName(/^Select /);
    await check.click();
    await expect(check).toHaveAccessibleName(/^Deselect /);
    await expect(page.getByTestId("pick-count")).toHaveText("1 selected");
    await expect(page.getByRole("button", { name: "Clear selection" })).toBeVisible();

    // The verb archives; the link leads to what is archived.
    await expect(page.getByTestId("pick-archive")).toHaveText("Archive");
    await expect(page.getByRole("link", { name: "Archived", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
  });

  for (const [platform, key] of [
    ["Win32", "Ctrl"],
    ["Linux x86_64", "Ctrl"],
    ["MacIntel", "⌘"],
  ] as const) {
    test(`the send hint says ${key} on ${platform}`, async ({ page }) => {
      await onPlatform(page, platform);
      await register(page);
      await createProject(page, unique("Keys"));
      await addTask(page, "Todo", "Keyed");

      const panel = page.getByTestId("task-panel");
      await expect(panel.getByText(`Markdown · ${key} + Enter to send`)).toBeVisible();
    });
  }
});
