import { expect, test } from "@playwright/test";
import { addListView, addTask, card, createProject, register, unique } from "./helpers";

/*
 * The card editor in a panel on the board. The board behind it is the
 * preview, so a click in the panel shows on the cards at once.
 */

test.describe("Card panel", () => {
  test("the Card button arranges the open view's card from the board", async ({
    page,
  }, testInfo) => {
    await register(page);
    await createProject(page, unique("Arranged"));
    await addTask(page, "Todo", "Arranged on the board");

    const boardName = "Board";
    const board = page.getByTestId("view-pill").filter({ hasText: boardName });
    await addListView(page, "Rows");
    await board.click();
    await expect(page.getByTestId("list-view")).toHaveCount(0);

    const key = card(page, "Arranged on the board").getByText(/^[A-Z0-9]+-1$/);
    await expect(key).toBeVisible();

    // The button sits before Sort.
    const tools = page.locator('[data-testid="card-button"], [data-testid="sort-button"]');
    await expect(tools.first()).toHaveAttribute("data-testid", "card-button");

    await page.getByTestId("card-button").click();
    const panel = page.getByTestId("card-panel");
    await expect(panel.getByRole("heading", { name: "Card" })).toBeVisible();
    await expect(panel.getByText(`How a card reads on ${boardName}`)).toBeVisible();
    const note = page.getByTestId("card-panel-note");
    await expect(note).toContainText(
      `${boardName} follows the default card, with List and Rows. Your first change here gives ${boardName} a card of its own.`,
    );
    await expect(note.getByRole("button", { name: "Change the default instead" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-card-panel.png") });

    // The first change forks the view, and the card behind changes at once.
    await panel.getByRole("button", { name: /^Task ID, / }).click();
    await page
      .getByRole("dialog", { name: "Task ID on the card" })
      .getByRole("button", { name: "Take off the card" })
      .click();
    await expect(key).toHaveCount(0);
    await expect(note).toContainText(
      `${boardName} has a card of its own. A change to the default does not reach it.`,
    );
    await page.screenshot({ path: testInfo.outputPath("seen-card-panel-own.png") });

    // One panel at a time.
    await card(page, "Arranged on the board").click();
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(panel).toHaveCount(0);
    await page.getByTestId("card-button").click();
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("task-panel")).toHaveCount(0);

    // Escape puts it away.
    await panel.focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    // Use the default asks in place, and the key comes back.
    await page.getByTestId("card-button").click();
    await note.getByRole("button", { name: "Use the default" }).click();
    await note.getByRole("button", { name: "Yes, use the default" }).click();
    await expect(key).toBeVisible();
    await expect(note).toContainText("follows the default card");

    // The default can be edited from here too, and it names who draws it.
    await note.getByRole("button", { name: "Change the default instead" }).click();
    await expect(note).toContainText(
      `This is the default card. ${boardName}, List and Rows draw it.`,
    );
    await expect(note.getByRole("button", { name: `Back to ${boardName}` })).toBeVisible();

    // The change survives a reload, so it was written.
    await panel.getByRole("button", { name: /^Task ID, / }).click();
    await page
      .getByRole("dialog", { name: "Task ID on the card" })
      .getByRole("button", { name: "Take off the card" })
      .click();
    await expect(key).toHaveCount(0);
    await page.reload();
    await expect(card(page, "Arranged on the board")).toBeVisible();
    await expect(key).toHaveCount(0);
  });
});
