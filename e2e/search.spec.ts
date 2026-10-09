import { expect, test } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

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

/*
 * The two walks with `@smoke` on them. The words, the arrows, the description,
 * a hidden hit and the `/` key are `src/components/board/Search.test.tsx`.
 */
test.describe("Finding a task", () => {
  test("finds a task by words in its title and opens it", { tag: "@smoke" }, async ({ page }) => {
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

  test("finds a task by its key, and by the number alone", { tag: "@smoke" }, async ({ page }) => {
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
});
