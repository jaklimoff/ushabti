import { expect, test, type Locator } from "@playwright/test";
import { addTask, boxValue, createProject, fillBox, register, unique } from "./helpers";

/**
 * The description is always its editor. A click goes straight into the
 * words, and no line but the clicked one changes how it looks, so nothing on
 * the panel jumps. Leaving the box saves, Mod + Enter saves and leaves it,
 * and Escape puts the saved words back and saves nothing.
 */

const WORDS = "## Plan\n\nShip the **first** part.\n\nThen the *second* part.\n\nThe end.";

/** Where each line of the box sits, and where the checklist under it is. */
async function layout(editor: Locator) {
  const lines = await editor.evaluate((el) =>
    [...el.querySelectorAll(".cm-line")].map((l) => {
      const r = l.getBoundingClientRect();
      return { top: Math.round(r.top), height: Math.round(r.height) };
    }),
  );
  const under = await editor.page().getByRole("button", { name: "Add item" }).boundingBox();
  return { lines, under: Math.round(under!.y) };
}

test("a click goes into the description and moves nothing", async ({ page }, testInfo) => {
  await register(page, "Ada Lovelace");
  await createProject(page, unique("Click"));
  await addTask(page, "Todo", "Click into me");

  // The box is the editor from the start, with no Click to edit.
  const editor = page.getByTestId("live-editor");
  await expect(editor).toBeVisible();
  await expect(page.getByText("Click to edit")).toHaveCount(0);
  await expect(editor).not.toBeFocused();

  // Leaving the box saves it, and the words read rendered.
  await fillBox(editor, WORDS);
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH");
  await page.getByTestId("task-title").click();
  expect((await saved).ok()).toBe(true);
  await expect(editor).not.toContainText("##");
  await expect(editor).not.toContainText("**");

  // A click on one line puts the caret there; no other line moves.
  const before = await layout(editor);
  const second = editor.locator(".cm-line", { hasText: "second" });
  await second.click();
  await expect(editor).toBeFocused();
  await expect(second).toContainText("*second*");
  await expect(editor).not.toContainText("##");
  await expect(editor).not.toContainText("**");
  expect(await layout(editor)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath("seen-description-click.png") });

  // Escape puts the saved words back, leaves the box and saves nothing.
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH") writes.push(r.url());
  });
  await page.keyboard.type(" Not kept.");
  await page.keyboard.press("Escape");
  await expect(editor).not.toBeFocused();
  await expect.poll(() => boxValue(editor)).toBe(WORDS);
  await expect(page.getByTestId("task-title")).toBeVisible();

  // Mod + Enter saves and leaves the box.
  await editor.locator(".cm-line", { hasText: "The end." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Kept.");
  const kept = page.waitForResponse((r) => r.request().method() === "PATCH");
  await page.keyboard.press("ControlOrMeta+Enter");
  expect((await kept).ok()).toBe(true);
  await expect(editor).not.toBeFocused();
  expect(writes).toHaveLength(1);

  // A fresh page reads what was saved, and nothing that was thrown away.
  await page.reload();
  await expect.poll(() => boxValue(page.getByTestId("live-editor"))).toBe(`${WORDS} Kept.`);
});
