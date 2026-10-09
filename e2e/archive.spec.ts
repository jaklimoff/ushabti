import { expect, test } from "@playwright/test";
import { addTask, card, createProject, register, settles, unique } from "./helpers";

type Page = import("@playwright/test").Page;

/** Archives the task whose panel is open, from the panel menu. */
async function archiveOpenTask(page: Page) {
  await page.getByRole("button", { name: "Task menu" }).click();
  await page.getByTestId("archive-task").click();
  await expect(page.getByTestId("archived-row")).toBeVisible();
}

test.describe("Archiving a task", () => {
  test(
    "archives from the panel, keeps the history, and puts it back",
    { tag: "@smoke" },
    async ({ page }) => {
      await register(page);
      await createProject(page, unique("Archive"));

      await addTask(page, "Todo", "Ship the release image");
      const comment = page.getByPlaceholder("Leave a note…");
      await comment.fill("The image builds.");
      await page.getByRole("button", { name: "Comment", exact: true }).click();
      await expect(page.getByRole("tab", { name: /^Comments 1/ })).toBeVisible();

      await archiveOpenTask(page);

      // The card is off the board, and the panel says why it is.
      await expect(card(page, "Ship the release image")).toHaveCount(0);
      await expect(page.getByTestId("archived-row")).toContainText("Archived just now");

      // Everything on the task is still there.
      await expect(page.getByRole("tab", { name: /^Comments 1/ })).toBeVisible();
      await page.getByRole("tab", { name: /^Activity/ }).click();
      await expect(page.getByText(/archived the task/)).toBeVisible();

      await page.getByRole("button", { name: "Put back", exact: true }).click();
      await expect(page.getByTestId("archived-row")).toHaveCount(0);
      await expect(card(page, "Ship the release image").first()).toBeVisible();

      await page.getByRole("tab", { name: /^Activity/ }).click();
      await expect(page.getByText(/put the task back/)).toBeVisible();

      // It survives a reload, on both sides of the change.
      await page.reload();
      await expect(card(page, "Ship the release image").first()).toBeVisible();
    },
  );

  /*
   * The page a team opens to see what is in the drawer. It draws the archived
   * tasks the browser already carries, so it asks the server nothing until
   * somebody puts one back.
   */
  test(
    "the archive page lists what went, newest first, and puts one back",
    { tag: "@smoke" },
    async ({ page }) => {
      await register(page);
      const projectId = await createProject(page, unique("Drawer"));

      for (const title of ["First to go", "Second to go"]) {
        await addTask(page, "Todo", title);
        await archiveOpenTask(page);
        await page.getByRole("button", { name: "Close task" }).click();
      }
      await addTask(page, "Todo", "Still on the board");
      await page.getByRole("button", { name: "Close task" }).click();

      // The way in is the top bar, beside Settings. The archive is not a view.
      await page.getByRole("link", { name: "Archived", exact: true }).click();
      await page.waitForURL(`**/p/${projectId}/archived`);

      const rows = page.getByTestId("archive-row");
      await expect(rows).toHaveCount(2);
      await expect(page.getByText("2 archived tasks")).toBeVisible();

      // Newest archived first, and only the archived ones.
      await expect(rows.nth(0)).toContainText("Second to go");
      await expect(rows.nth(0)).toContainText("Archived just now");
      await expect(rows.nth(1)).toContainText("First to go");
      await expect(page.getByText("Still on the board")).toHaveCount(0);

      // The box narrows the list by key and title, and nothing else moves.
      const find = page.getByTestId("archive-find");
      await find.fill("first");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("First to go");
      await find.fill("nothing by that name");
      await expect(page.getByText("No archived task by those words.")).toBeVisible();
      await find.fill("");
      await expect(rows).toHaveCount(2);

      // A row opens the task, exactly as its link does.
      await rows.nth(1).getByRole("link").click();
      await expect(page.getByTestId("task-title")).toHaveValue("First to go");
      await expect(page.getByTestId("archived-row")).toBeVisible();
      await page.goBack();

      // One press, and it is back where it was.
      await settles(page, /\/api\/tasks\/[0-9a-f-]+\/archive$/, () =>
        rows.filter({ hasText: "First to go" }).getByTestId("archive-put-back").click(),
      );
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("Second to go");
      await expect(page.getByTestId("toast")).toContainText("is back on the board");

      await page.getByRole("link", { name: "Back to board" }).click();
      await expect(card(page, "First to go").first()).toBeVisible();
      await expect(card(page, "Second to go")).toHaveCount(0);
    },
  );
});
