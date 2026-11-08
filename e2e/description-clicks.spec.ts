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

  // A drag that ends in the box's margin, below the words, also leaves it closed.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const box = page.getByRole("button", { name: /Copy the first words/ });
  const size = (await box.boundingBox())!;
  await words.locator("strong").dragTo(box, {
    targetPosition: { x: size.width / 2, y: size.height - 4 },
  });
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain(
    "words and the last",
  );
  // Long enough for a click that would open the editor to have opened it.
  await page.waitForTimeout(500);
  await expect(editor).toHaveCount(0);

  // So does a double click that selects a word.
  await words.locator("em").dblclick({ position: { x: 4, y: 5 } });
  await page.waitForTimeout(500);
  await expect(editor).toHaveCount(0);
  expect((await page.evaluate(() => window.getSelection()?.toString() ?? "")).trim()).toBe("last");
  await page.screenshot({ path: testInfo.outputPath("seen-description-word.png") });

  // A plain click on the words still opens the editor.
  await words.locator("strong").click();
  await expect(editor).toBeFocused();
});
