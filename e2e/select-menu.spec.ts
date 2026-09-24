import { expect, test } from "@playwright/test";
import { addTask, card, column, createProject, register, settles, unique } from "./helpers";

type Page = import("@playwright/test").Page;

/** Any write to a task's values: one task, or the picked ones in one call. */
const WRITE = /\/api\/(tasks\/[0-9a-f-]+\/values\/[0-9a-f-]+|projects\/[0-9a-f-]+\/tasks\/values)$/;

/*
 * Status has five options with long names, so it is a menu rather than a row
 * of buttons. "re" matches two of them: In Progress and Ready. Enter used to
 * make a sixth option called "re", which is a column everybody sees.
 */
function statusOf(page: Page) {
  return page.getByTestId("task-panel").locator('[data-property="Status"]');
}

test.describe("The menu of a select", () => {
  test("Enter picks the highlighted match and makes nothing", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Menu"));
    await addTask(page, "Todo", "Write the notes");
    const columns = await page.getByTestId("column").count();

    const status = statusOf(page);
    await status.getByRole("button", { name: "Todo" }).click();
    const box = status.getByLabel("Find or add status");
    await box.fill("re");

    /* Two matches, and an explicit row to make a new one after them. */
    const at = status.locator('[data-at="true"]');
    await expect(at).toHaveText(/In Progress/);
    await expect(status.getByRole("button", { name: "Add “re”" })).toBeVisible();

    await box.press("ArrowDown");
    await expect(at).toHaveText(/Ready/);
    await settles(page, WRITE, () => box.press("Enter"));

    await expect(column(page, "Ready").getByText("Write the notes")).toBeVisible();
    await expect(page.getByTestId("column")).toHaveCount(columns);

    /* The name that is there is picked, and never offered again. */
    await status.getByRole("button", { name: "Ready" }).click();
    await box.fill("todo");
    await expect(status.getByRole("button", { name: /^Add/ })).toHaveCount(0);
    await settles(page, WRITE, () => box.press("Enter"));
    await expect(column(page, "Todo").getByText("Write the notes")).toBeVisible();

    /* A new option comes only from its own row, and Enter on it is a choice. */
    await status.getByRole("button", { name: "Todo" }).click();
    await box.fill("Blocked");
    await expect(at).toHaveText("Add “Blocked”");
    await box.press("Enter");
    await expect(column(page, "Blocked").getByText("Write the notes")).toBeVisible();

    await page.reload();
    await expect(column(page, "Blocked").getByText("Write the notes")).toBeVisible();
    await expect(page.getByTestId("column")).toHaveCount(columns + 1);
  });

  test("walks the same way for the picked cards", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Menu picked"));
    for (const title of ["Aardvark", "Beetle"]) {
      await addTask(page, "Todo", title);
      await page.getByRole("button", { name: "Close task" }).click();
    }
    const columns = await page.getByTestId("column").count();

    for (const title of ["Aardvark", "Beetle"]) {
      await card(page, title).getByTestId("card-pick").click();
    }
    await page.getByTestId("pick-set").click();
    const search = page.getByTestId("pick-search");
    await search.fill("Status");
    await search.press("Enter");

    const menu = page.getByTestId("pick-menu");
    await menu.getByRole("button", { name: /Empty/ }).first().click();
    const box = menu.getByLabel("Find or add status");
    await box.fill("re");
    await box.press("ArrowDown");
    await expect(menu.locator('[data-at="true"]')).toHaveText(/Ready/);
    await settles(page, WRITE, () => box.press("Enter"));
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(column(page, "Ready").getByTestId("card")).toHaveCount(2);
    await expect(page.getByTestId("column")).toHaveCount(columns);
  });
});
