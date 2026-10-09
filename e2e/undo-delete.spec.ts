import { expect, test } from "@playwright/test";
import { addTask, card, createProject, register, settles, unique } from "./helpers";

type Page = import("@playwright/test").Page;

/** Deletes the task whose panel is open, from the panel menu. */
async function deleteOpenTask(page: Page) {
  await page.getByRole("button", { name: "Task menu" }).click();
  await settles(page, /\/api\/tasks\/[0-9a-f-]+$/, () =>
    page.getByRole("button", { name: "Delete task" }).click(),
  );
}

test.describe("Undoing a delete", () => {
  /*
   * The whole way round: a delete takes the card off the board and the task
   * out of the search, the drawer holds it, and one press brings it back as
   * the task it was — with its key, its comment and its place.
   */
  test("a deleted task leaves the board and the search, and comes back whole", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Undo"));

    await addTask(page, "Todo", "Rotate the signing key");
    const key = await page.getByTestId("task-key").innerText();
    const comment = page.getByPlaceholder("Leave a note…");
    await comment.fill("The key is in the vault.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByRole("tab", { name: /^Comments 1/ })).toBeVisible();

    await addTask(page, "Todo", "Still on the board");
    await page.getByRole("button", { name: "Close task" }).click();

    await page.goto(`/p/${projectId}?task=${key}`);
    await deleteOpenTask(page);

    /* The way back is on another page, so the one line the board draws has to
       say so, and has to say how long there is. Without it the undo is
       invisible to anybody who never opens the archive page. */
    await expect(page.getByTestId("toast")).toContainText(
      `${key} deleted. It stays under Archived for 30 days.`,
    );

    // Off the board, and off it after a reload as well.
    await expect(card(page, "Rotate the signing key")).toHaveCount(0);
    await page.reload();
    await expect(card(page, "Rotate the signing key")).toHaveCount(0);
    await expect(card(page, "Still on the board").first()).toBeVisible();

    // A search hides it too. An archived task is still found; a deleted one
    // is not there at all.
    const box = page.getByTestId("search-box");
    await box.fill("signing key");
    await expect(page.getByTestId("search-hit")).toHaveCount(0);
    await box.fill("");

    // The drawer has it, with how long is left.
    await page.getByRole("link", { name: "Archived", exact: true }).click();
    await page.waitForURL(`**/p/${projectId}/archived`);
    const row = page.getByTestId("deleted-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(key);
    await expect(row).toContainText("Rotate the signing key");
    await expect(row).toContainText("Deleted just now");
    await expect(row).toContainText("30 days left");
    await expect(page.getByText("Deleted, gone in 30 days")).toBeVisible();
    /* Each list says its own count. One number over two lists would have to
       name which list it counted. */
    await expect(page.getByText("1 deleted task.")).toBeVisible();
    await expect(page.getByText("1 archived task.")).toHaveCount(0);

    // One press, no question asked: a put back takes nothing away.
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/restore$/, () =>
      row.getByTestId("deleted-put-back").click(),
    );
    await expect(page.getByTestId("deleted-row")).toHaveCount(0);
    await expect(page.getByTestId("deleted-section")).toHaveCount(0);
    await expect(page.getByTestId("toast")).toContainText("is back");

    // And it is the task it was: the same key, and everything on it.
    await page.goto(`/p/${projectId}?task=${key}`);
    await expect(page.getByTestId("task-key")).toHaveText(key);
    await expect(page.getByTestId("task-title")).toHaveValue("Rotate the signing key");
    await expect(page.getByRole("tab", { name: /^Comments 1/ })).toBeVisible();
    await expect(card(page, "Rotate the signing key").first()).toBeVisible();
  });
});
