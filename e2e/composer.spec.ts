import { expect, test, type Locator } from "@playwright/test";
import { addListView, addTask, createProject, register, unique } from "./helpers";

const FIVE_LINES = [
  "Move the invoices",
  "to the new bucket",
  "and tell accounting",
  "before the end of the month",
  "so nothing is paid twice",
].join("\n");

/** The height the box draws, and whether it hides any of its text. */
async function box(input: Locator) {
  return input.evaluate((el) => ({
    height: el.clientHeight,
    scrolls: el.scrollHeight > el.clientHeight,
  }));
}

/** Grows with five lines, shows every one, and shrinks back when they go. */
async function grows(input: Locator) {
  expect(await box(input)).toEqual({ height: 42, scrolls: false });

  await input.fill(FIVE_LINES);
  const tall = await box(input);
  expect(tall.scrolls).toBe(false);
  // Five lines of 12.5px at a line height of 1.4.
  expect(tall.height).toBeGreaterThanOrEqual(5 * 17);

  await input.fill("Short again");
  expect(await box(input)).toEqual({ height: 42, scrolls: false });
}

test.describe("The new-task composer", () => {
  test("grows with a long title in a column, and the @ list opens under it", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Grow"));

    await page.getByRole("button", { name: "Add a task to Todo" }).first().click();
    const input = page.getByPlaceholder("What needs doing?");
    await grows(input);

    // The list hangs from the whole composer, so a tall box never covers it.
    await input.fill(FIVE_LINES);
    await input.pressSequentially(" @");
    const list = page.getByTestId("mention-list");
    await expect(list).toBeVisible();
    const under = (await list.boundingBox())!;
    const typed = (await input.boundingBox())!;
    expect(under.y).toBeGreaterThanOrEqual(typed.y + typed.height);
  });

  test("grows the same way at the end of a list", async ({ page }) => {
    await register(page);
    await createProject(page, unique("GrowList"));
    await addTask(page, "Todo", "One row");
    await page.getByRole("button", { name: "Close task" }).click();
    await addListView(page, "Rows");

    await page.getByTestId("list-add").click();
    const input = page.getByPlaceholder("What needs doing?");
    await expect(input).toBeFocused();
    await grows(input);
  });
});
