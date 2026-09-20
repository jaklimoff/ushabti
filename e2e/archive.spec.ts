import { expect, test } from "@playwright/test";
import { addTask, card, column, confirmDelete, createProject, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;

/** Archives the task whose panel is open, from the panel menu. */
async function archiveOpenTask(page: Page) {
  await page.getByRole("button", { name: "Task menu" }).click();
  await page.getByTestId("archive-task").click();
  await expect(page.getByTestId("archived-row")).toBeVisible();
}

test.describe("Archiving a task", () => {
  test("archives from the panel, keeps the history, and puts it back", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Archive"));

    await addTask(page, "Todo", "Ship the release image");
    const comment = page.getByPlaceholder("Leave a note…");
    await comment.fill("The image builds.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Comments 1/ })).toBeVisible();

    await archiveOpenTask(page);

    // The card is off the board, and the panel says why it is.
    await expect(card(page, "Ship the release image")).toHaveCount(0);
    await expect(page.getByTestId("archived-row")).toContainText("Archived just now");

    // Everything on the task is still there.
    await expect(page.getByRole("button", { name: /^Comments 1/ })).toBeVisible();
    await page.getByRole("button", { name: /^Activity/ }).click();
    await expect(page.getByText(/archived the task/)).toBeVisible();

    await page.getByRole("button", { name: "Put it back" }).click();
    await expect(page.getByTestId("archived-row")).toHaveCount(0);
    await expect(card(page, "Ship the release image").first()).toBeVisible();

    await page.getByRole("button", { name: /^Activity/ }).click();
    await expect(page.getByText(/put the task back/)).toBeVisible();

    // It survives a reload, on both sides of the change.
    await page.reload();
    await expect(card(page, "Ship the release image").first()).toBeVisible();
  });

  test("archives everything in a column, after a question that names the count", async ({
    page,
  }) => {
    await register(page);
    await createProject(page, unique("Sweep"));

    for (const title of ["First shipped", "Second shipped"]) {
      await addTask(page, "Shipped", title);
      await page.getByRole("button", { name: "Close task" }).click();
    }
    await addTask(page, "Todo", "Still to do");
    await page.getByRole("button", { name: "Close task" }).click();

    await expect(column(page, "Shipped").getByTestId("column-count")).toHaveText("2");

    await page.getByRole("button", { name: "Archive everything in Shipped" }).click();
    const question = page.getByTestId("column-confirm");
    await expect(question).toContainText("Archive 2 tasks in Shipped?");
    await expect(question).toContainText("They leave the board and keep their history.");

    // Cancel leaves the column alone.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(column(page, "Shipped").getByTestId("column-count")).toHaveText("2");

    await page.getByRole("button", { name: "Archive everything in Shipped" }).click();
    await confirmDelete(page, /^Yes, archive$/);

    await expect(column(page, "Shipped").getByTestId("card")).toHaveCount(0);
    await expect(card(page, "Still to do").first()).toBeVisible();

    await page.reload();
    await expect(column(page, "Shipped").getByTestId("card")).toHaveCount(0);
  });

  test("a search still finds an archived task, says so, and its link opens it", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Finding"));

    await addTask(page, "Todo", "Rate limit the sign-in route");
    const key = await page.getByTestId("task-key").innerText();
    await archiveOpenTask(page);
    await page.getByRole("button", { name: "Close task" }).click();

    const box = page.getByTestId("search-box");
    await box.fill("rate limit");
    const hit = page.getByTestId("search-hit").first();
    await expect(hit).toContainText("Rate limit the sign-in route");
    await expect(hit).toContainText("archived");

    await hit.click();
    await expect(page.getByTestId("task-title")).toHaveValue("Rate limit the sign-in route");
    await expect(page.getByTestId("archived-row")).toBeVisible();

    // The link a person pastes into a chat opens the panel, with no card
    // behind it.
    await page.goto(`/p/${projectId}?task=${key}`);
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(page.getByTestId("task-title")).toHaveValue("Rate limit the sign-in route");
    await expect(page.getByTestId("archived-row")).toBeVisible();
    await expect(page.getByTestId("card")).toHaveCount(0);
  });
});
