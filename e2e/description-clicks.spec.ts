import { expect, test } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

/**
 * Words selected in a description with a drag stay selected, to be copied:
 * the click that ends the drag does not open the editor. A plain click on
 * the words still does.
 */

test("a drag that selects words in a description leaves the editor closed", async ({
  page,
}, testInfo) => {
  await register(page, "Ada Lovelace");
  await createProject(page, unique("Select"));
  await addTask(page, "Todo", "Copy from me");

  await page.getByText("Add a description…").click();
  const editor = page.getByTestId("live-editor");
  await expect(editor).toBeFocused();
  await page.keyboard.type("Copy the **first words** and the *last words* of this line.");
  // Leaving the box saves it and puts the rendered words back.
  await page.getByTestId("task-title").click();
  const words = page.getByTestId("markdown");
  await expect(words.locator("em")).toBeVisible();
  await expect(editor).toHaveCount(0);

  await words.locator("strong").dragTo(words.locator("em"));

  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).toContain("words and the last");
  await expect(editor).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("seen-description-selected.png") });

  // A plain click on the words still opens the editor.
  await words.locator("strong").click();
  await expect(editor).toBeFocused();
});
