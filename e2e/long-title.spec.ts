import { expect, test, type Locator } from "@playwright/test";
import { addListView, addTask, card, createProject, listRow, register, unique } from "./helpers";

/** How many lines a box draws, from its height and its own line height. */
async function linesOf(box: Locator): Promise<number> {
  return box.evaluate((node) => {
    const lineHeight = parseFloat(getComputedStyle(node).lineHeight);
    return Math.round(node.getBoundingClientRect().height / lineHeight);
  });
}

// As long as a title may be: 400 characters.
const LONG = `A long title ${"that keeps on going ".repeat(20)}`.slice(0, 400);

test.describe("A long title", () => {
  test("is cut to three lines on a card, and the whole of it is a hover away", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Long title"));
    await addTask(page, "Todo", LONG);
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "Todo", "Short one");
    await page.getByRole("button", { name: "Close task" }).click();

    const long = card(page, LONG.slice(0, 40)).getByTestId("card-title");
    expect(await linesOf(long)).toBe(3);
    // The words past the third line are cut, not gone.
    expect(await long.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect(long).toHaveAttribute("title", LONG);

    // A title that fits still says itself on hover.
    const short = card(page, "Short one").getByTestId("card-title");
    expect(await linesOf(short)).toBe(1);
    await expect(short).toHaveAttribute("title", "Short one");

    await addListView(page, "Everything");
    const row = listRow(page, LONG.slice(0, 40)).getByTestId("list-row-title");
    await expect(row).toHaveAttribute("title", LONG);
    await expect(listRow(page, "Short one").getByTestId("list-row-title")).toHaveAttribute(
      "title",
      "Short one",
    );
  });
});
