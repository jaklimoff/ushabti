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
    await expect(status.getByRole("option", { name: "Add “re”" })).toBeVisible();

    await box.press("ArrowDown");
    await expect(at).toHaveText(/Ready/);
    await settles(page, WRITE, () => box.press("Enter"));

    await expect(column(page, "Ready").getByText("Write the notes")).toBeVisible();
    await expect(page.getByTestId("column")).toHaveCount(columns);

    /* The name that is there is picked, and never offered again. */
    await status.getByRole("button", { name: "Ready" }).click();
    await box.fill("todo");
    await expect(status.getByRole("option", { name: /^Add/ })).toHaveCount(0);
    await settles(page, WRITE, () => box.press("Enter"));
    await expect(column(page, "Todo").getByText("Write the notes")).toBeVisible();

    /* A new option comes only from its own row, and Enter on it is a choice.
       The answer is held back, so a second Enter lands while the first is on
       its way: one Enter makes one option, however quick the hand. */
    await status.getByRole("button", { name: "Todo" }).click();
    await box.fill("Blocked");
    await expect(at).toHaveText("Add “Blocked”");
    let made = 0;
    await page.route("**/api/properties/*/options", async (route) => {
      if (route.request().method() === "POST") {
        made += 1;
        await new Promise((done) => setTimeout(done, 600));
      }
      await route.fallback();
    });
    await box.press("Enter");
    await box.press("Enter");
    await expect(column(page, "Blocked").getByText("Write the notes")).toBeVisible();

    await page.reload();
    await expect(column(page, "Blocked").getByText("Write the notes")).toBeVisible();
    await expect(page.getByTestId("column")).toHaveCount(columns + 1);
    expect(made).toBe(1);
  });

  /* Labels is a multi-select: its menu stays open to take a second option.
     "u" matches bug, feature and ux. */
  test("a multi-select walks, stays open, and keeps the box", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Menu labels"));
    await addTask(page, "Todo", "Tidy the header");

    const labels = page.getByTestId("task-panel").locator('[data-property="Labels"]');
    await labels.getByRole("button", { name: "+ labels" }).click();
    const box = labels.getByLabel("Find or add labels");
    await box.fill("u");
    const at = labels.locator('[data-at="true"]');
    await expect(at).toHaveText(/bug/);
    await box.press("ArrowDown");
    await box.press("ArrowDown");
    await expect(at).toHaveText(/ux/);
    await settles(page, WRITE, () => box.press("Enter"));

    /* It stays open, on the row it just toggled, and the box is cleared. */
    const list = labels.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(box).toHaveValue("");
    await expect(at).toHaveText(/ux/);
    await expect(list.getByRole("option", { name: "ux" })).toHaveAttribute("aria-selected", "true");

    /* A press on a row leaves the focus in the box, so the keys still walk. */
    await settles(page, WRITE, () => list.getByRole("option", { name: "bug" }).click());
    await expect(box).toBeFocused();
    await box.press("ArrowDown");
    await expect(at).toHaveText(/feature/);
    await expect(box).toHaveAttribute("aria-activedescendant", (await at.getAttribute("id"))!);

    await page.reload();
    await card(page, "Tidy the header").click();
    await expect(labels.getByText("ux")).toBeVisible();
    await expect(labels.getByText("bug")).toBeVisible();
    await labels.getByRole("button", { name: "+ labels" }).click();
    await expect(labels.getByRole("option")).toHaveCount(5);
    await expect(labels.getByRole("option", { name: "u", exact: true })).toHaveCount(0);
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
