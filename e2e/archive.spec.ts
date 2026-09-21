import { expect, test } from "@playwright/test";
import {
  addTask,
  card,
  column,
  confirmDelete,
  createProject,
  gotoSettings,
  register,
  unique,
} from "./helpers";

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
    // The board says how many went, in the server's own number.
    await expect(page.getByTestId("toast")).toContainText("Archived 2 tasks");

    /* An empty column is not proof of an archive: a delete would leave the
       same board. So find one of them, see the word on its row, open it, and
       read its own history. */
    await page.getByTestId("search-box").fill("first shipped");
    const hit = page.getByTestId("search-hit").first();
    await expect(hit).toContainText("First shipped");
    await expect(hit).toContainText("archived");
    await hit.click();

    await expect(page.getByTestId("archived-row")).toBeVisible();
    await page.getByRole("button", { name: /^Activity/ }).click();
    await expect(page.getByText(/archived the task/)).toBeVisible();

    // And it comes back where it was.
    await page.getByRole("button", { name: "Put it back" }).click();
    await expect(card(page, "First shipped").first()).toBeVisible();
    await expect(column(page, "Shipped").getByTestId("column-count")).toHaveText("1");

    await page.reload();
    await expect(column(page, "Shipped").getByTestId("column-count")).toHaveText("1");
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

  /*
   * A link to an archived task opens a panel with no card behind it. The key,
   * the title and the archived row come from the board's own archived list, so
   * they are on screen before the panel's own read of the task lands. It used
   * to draw nothing at all until then.
   */
  test("a link to an archived task draws its head before the detail lands", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Pasted"));

    await addTask(page, "Todo", "Rotate the signing key");
    const key = await page.getByTestId("task-key").innerText();
    await archiveOpenTask(page);

    /* Hold back the one read the panel makes for itself. What is left on the
       screen is what the board already knew. */
    await page.route("**/api/tasks/*", async (route) => {
      await new Promise((wait) => setTimeout(wait, 3000));
      await route.continue();
    });

    await page.goto(`/p/${projectId}?task=${key}`);

    // The read is still out: the panel says so, and the head is already there.
    await expect(page.getByTestId("panel-loading")).toBeVisible();
    await expect(page.getByTestId("task-key")).toHaveText(key);
    await expect(page.getByTestId("task-title")).toHaveValue("Rotate the signing key");
    await expect(page.getByTestId("archived-row")).toBeVisible();

    // Then the rest of the task arrives, and no card is drawn behind it.
    await expect(page.getByTestId("panel-loading")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Comments/ })).toBeVisible();
    await expect(page.getByTestId("card")).toHaveCount(0);
  });

  /*
   * The cascade behind a delete does not care whether a task is on a board, so
   * a question that counted only the cards would name half the cost.
   */
  test("the cost of a delete counts the archived tasks too", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Cost"));

    for (const title of ["Live estimate", "Archived estimate"]) {
      await addTask(page, "Todo", title);
      await page.getByRole("button", { name: "XL", exact: true }).click();
      if (title === "Archived estimate") await archiveOpenTask(page);
      await page.getByRole("button", { name: "Close task" }).click();
    }

    // One card left on the board, two values in the project.
    await expect(page.getByTestId("card")).toHaveCount(1);

    await gotoSettings(page, projectId);
    await page.getByRole("button", { name: "Delete the property Estimate" }).click();
    await expect(
      page.getByText("Delete Estimate? 5 options and 2 values go with it."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // And the key rename counts them as well, because it renames them too.
    await gotoSettings(page, projectId, "project");
    await page.getByLabel("Project key", { exact: true }).fill("ZZZ");
    await expect(page.getByText(/2 tasks are called .*today/)).toBeVisible();
  });
});
