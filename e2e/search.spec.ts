import { expect, test } from "@playwright/test";
import { addFilter, addTask, createProject, register, saved, unique } from "./helpers";

type Page = import("@playwright/test").Page;

function box(page: Page) {
  return page.getByTestId("search-box");
}

/** The rows the box is offering, top to bottom. */
function hits(page: Page) {
  return page.getByTestId("search-hit");
}

async function find(page: Page, words: string) {
  await box(page).fill(words);
  await expect(page.getByTestId("search-hits")).toBeVisible();
}

test.describe("Finding a task", () => {
  test("finds a task by words in its title and opens it", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Finding"));

    await addTask(page, "Todo", "Rate limit the sign-in route");
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "Backlog", "Ship the release image");
    await page.getByRole("button", { name: "Close task" }).click();

    await find(page, "release");
    await expect(hits(page)).toHaveCount(1);
    await expect(hits(page).first()).toContainText("Ship the release image");

    await box(page).press("Enter");
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(page.getByTestId("task-title")).toHaveValue("Ship the release image");
    // The list goes when a task is opened; the words stay, so the next hit is
    // one press away.
    await expect(page.getByTestId("search-hits")).toHaveCount(0);
    await expect(box(page)).toHaveValue("release");
  });

  test("every word has to be somewhere, and the arrows pick between what is left", async ({
    page,
  }) => {
    await register(page);
    await createProject(page, unique("Words"));

    await addTask(page, "Todo", "Log in with a passkey");
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "Todo", "Write the login guide");
    await page.getByRole("button", { name: "Close task" }).click();

    await find(page, "log");
    await expect(hits(page)).toHaveCount(2);

    // A second word narrows; it never widens.
    await find(page, "log guide");
    await expect(hits(page)).toHaveCount(1);

    await find(page, "log");
    await box(page).press("ArrowDown");
    await box(page).press("Enter");
    await expect(page.getByTestId("task-title")).toHaveValue("Write the login guide");
  });

  test("finds a task by its key, and by the number alone", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Keys"));

    await addTask(page, "Todo", "The one we want");
    const key = await page.getByTestId("task-key").innerText();
    await page.getByRole("button", { name: "Close task" }).click();

    await find(page, key.toLowerCase());
    await expect(hits(page)).toHaveCount(1);
    await expect(hits(page).first()).toContainText("The one we want");

    await find(page, key.split("-")[1]);
    await expect(hits(page).first()).toContainText("The one we want");
  });

  test("finds words in the description and shows the line they are on", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Bodies"));

    await addTask(page, "Todo", "Nothing in the title");
    await page.getByText("Add a description…").click();
    const body = page.getByPlaceholder("Write in markdown…");
    await body.fill("The queue survives a reload.");
    await saved(page, () => body.blur());
    await page.getByRole("button", { name: "Close task" }).click();

    await find(page, "queue");
    await expect(hits(page).first()).toContainText("Nothing in the title");
    // The row says why it is a hit.
    await expect(hits(page).first()).toContainText("The queue survives a reload.");
  });

  test("a hit the view is hiding says so, and still opens", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Hidden"));

    await addTask(page, "Todo", "Urgent thing");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addTask(page, "Todo", "Ordinary thing");
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(page.getByTestId("task-count")).toHaveText("1 of 2 tasks");

    // A search reaches past the filter, because it hides nothing itself.
    await find(page, "thing");
    await expect(hits(page)).toHaveCount(2);
    await expect(hits(page).filter({ hasText: "Ordinary thing" })).toContainText(
      "not in this view",
    );
    await expect(hits(page).filter({ hasText: "Urgent thing" })).not.toContainText(
      "not in this view",
    );

    await hits(page).filter({ hasText: "Ordinary thing" }).click();
    await expect(page.getByTestId("task-title")).toHaveValue("Ordinary thing");
  });

  test("`/` opens the box, Escape puts the list away, and nothing is found in an empty box", async ({
    page,
  }) => {
    await register(page);
    await createProject(page, unique("Slash"));

    await addTask(page, "Todo", "Something to find");
    await page.getByRole("button", { name: "Close task" }).click();

    // Nothing has the focus: the slash has to reach the board from the page.
    await page.getByTestId("task-count").click();
    await page.keyboard.press("/");
    await expect(box(page)).toBeFocused();
    // The slash opened the box; it did not land in it.
    await expect(box(page)).toHaveValue("");
    await expect(page.getByTestId("search-hits")).toHaveCount(0);

    await page.keyboard.type("someth");
    await expect(hits(page)).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("search-hits")).toHaveCount(0);
    // Escape closed the list and left the board alone.
    await expect(page.getByTestId("task-panel")).toHaveCount(0);

    await find(page, "nothing by this name");
    await expect(hits(page)).toHaveCount(0);
    await expect(page.getByTestId("search-hits")).toContainText("No task by those words.");
  });
});
