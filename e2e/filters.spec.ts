import { expect, test } from "@playwright/test";
import { addTask, card, column, createProject, register, saved, settles, unique } from "./helpers";

type Page = import("@playwright/test").Page;

/**
 * Adds a rule: pick the property, then say what about it. Picking the property
 * on its own writes nothing, which is the point of the two steps.
 */
async function addFilter(page: Page, property: string, value: string) {
  await page.getByTestId("filter-button").click();
  const search = page.getByTestId("filter-search");
  await search.fill(property);
  await search.press("Enter");

  const box = page.getByTestId("filter-box");
  await box.fill(value);
  await settles(page, /\/api\/views\/[0-9a-f-]+$/, () => box.press("Enter"));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("filter-menu")).toHaveCount(0);
}

function chip(page: Page, text: string) {
  return page.getByTestId("filter-chip").filter({ hasText: text });
}

test.describe("Filters inside a view", () => {
  test("a filter narrows the board and the count says by how much", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Filtering"));

    await addTask(page, "Todo", "Urgent thing");
    // The panel opens on the new task, so the priority goes on straight away.
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addTask(page, "Todo", "Ordinary thing");
    await page.getByRole("button", { name: "Close task" }).click();

    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");
    await expect(page.getByTestId("filter-row")).toHaveCount(0);

    await addFilter(page, "Priority", "Urgent");

    await expect(chip(page, "Priority is Urgent")).toBeVisible();
    await expect(card(page, "Urgent thing")).toBeVisible();
    await expect(card(page, "Ordinary thing")).toHaveCount(0);
    await expect(page.getByTestId("task-count")).toHaveText("1 of 2 tasks");
    await expect(page.getByTestId("filter-button")).toContainText("Filter 1");

    // The ✕ on the chip is how a rule goes.
    await settles(page, /\/api\/views\//, () =>
      page.getByRole("button", { name: "Remove the filter Priority is Urgent" }).click(),
    );
    await expect(card(page, "Ordinary thing")).toBeVisible();
    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");
    await expect(page.getByTestId("filter-row")).toHaveCount(0);
  });

  test("a rule can be changed from its own chip", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Changing"));

    await addTask(page, "Todo", "Urgent thing");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addTask(page, "Todo", "High thing");
    await page.getByRole("button", { name: "High", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(card(page, "High thing")).toHaveCount(0);

    await chip(page, "Priority is Urgent").click();
    const editor = page.getByTestId("filter-editor");
    await expect(editor).toBeVisible();

    // Adding High widens the rule, then dropping Urgent narrows it again.
    await settles(page, /\/api\/views\//, () =>
      editor.getByRole("option", { name: "High" }).click(),
    );
    await expect(card(page, "Urgent thing")).toBeVisible();
    await expect(card(page, "High thing")).toBeVisible();

    await settles(page, /\/api\/views\//, () =>
      editor.getByRole("option", { name: "Urgent" }).click(),
    );
    await expect(chip(page, "Priority is High")).toBeVisible();
    await expect(card(page, "Urgent thing")).toHaveCount(0);
  });

  test("a rule about the grouping property takes its columns with it", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Columns"));

    await addTask(page, "Todo", "Only task");
    await page.getByRole("button", { name: "Close task" }).click();

    for (const name of ["Backlog", "Todo", "Shipped"]) {
      await expect(column(page, name)).toBeVisible();
    }

    // The board groups by Status, so a rule about Status also speaks about the
    // columns. A column a card could not live in would be a trap to drop into.
    await addFilter(page, "Status", "Backlog");
    await expect(chip(page, "Status is Backlog")).toBeVisible();
    await expect(column(page, "Backlog")).toBeVisible();
    await expect(column(page, "Todo")).toHaveCount(0);
    await expect(column(page, "Shipped")).toHaveCount(0);

    // Nothing is in Backlog, so the board says so rather than looking broken.
    await expect(page.getByText("No task passes the filter")).toBeVisible();

    await settles(page, /\/api\/views\//, () => page.getByTestId("filter-clear").click());
    await expect(column(page, "Todo")).toBeVisible();
    await expect(card(page, "Only task")).toBeVisible();
  });

  test("a filter belongs to its view, and stays there", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Belonging"));

    await addTask(page, "Todo", "Only task");
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    // The other view was never filtered and must not be.
    await page.getByRole("button", { name: /^Phases/ }).click();
    await expect(page.getByTestId("filter-row")).toHaveCount(0);
    await expect(card(page, "Only task")).toBeVisible();

    await page.getByRole("button", { name: /^Board/ }).click();
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    // It is on the view, not in this tab, so a reload finds it again.
    await page.goto(`/p/${projectId}`);
    await expect(chip(page, "Priority is Urgent")).toBeVisible();
    await expect(card(page, "Only task")).toHaveCount(0);
  });

  test("a task added under a filter is not hidden by it", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Adding"));

    await addTask(page, "Todo", "First task");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    // The composer says what it is about to write before it writes it.
    await page.getByRole("button", { name: "Add a task to the top of Todo" }).first().click();
    await expect(page.getByText("sets Priority Urgent")).toBeVisible();

    const box = page.getByPlaceholder("What needs doing?");
    await box.fill("Second task");
    await box.press("Enter");

    // Without the value the filter asks for, this card would be written and
    // hidden in the same breath.
    await expect(page.getByRole("button", { name: "Close task" })).toBeVisible();
    await page.getByRole("button", { name: "Close task" }).click();
    await expect(card(page, "Second task")).toBeVisible();
    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");
  });

  test("a new column joins the rule that would have hidden it", async ({ page }) => {
    await register(page);
    await createProject(page, unique("NewColumn"));

    await addFilter(page, "Status", "Backlog");
    await expect(chip(page, "Status is Backlog")).toBeVisible();
    await expect(column(page, "Todo")).toHaveCount(0);

    await page.getByRole("button", { name: "New column" }).click();
    const box = page.getByPlaceholder("Column name");
    await box.fill("Blocked");
    await settles(page, /\/api\/views\//, () => box.press("Enter"));

    // Nobody makes a column in order not to see it.
    await expect(column(page, "Blocked")).toBeVisible();
    await expect(chip(page, "Status is Backlog, Blocked")).toBeVisible();
  });

  test("a date rule is made empty and filled in afterwards", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Dates"));

    for (const [title, when] of [
      ["Due soon", "2026-09-01"],
      ["Due later", "2026-12-01"],
    ]) {
      await addTask(page, "Todo", title);
      const due = page.locator('[data-property="Due"]');
      await due.getByRole("button").click();
      await saved(page, async () => {
        await due.locator("input").fill(when);
        await due.locator("input").blur();
      });
      await page.getByRole("button", { name: "Close task" }).click();
    }

    // For a date the box is the answer, so there is no list to pick from.
    await page.getByTestId("filter-button").click();
    const search = page.getByTestId("filter-search");
    await search.fill("Due");
    await search.press("Enter");

    // The operator is the shape of the question, so it may have a default.
    // The answer may not, so no rule exists yet.
    await expect(page.getByTestId("filter-row")).toHaveCount(1);
    await expect(page.getByTestId("filter-chip")).toHaveCount(0);
    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");

    await page.getByRole("button", { name: "is before" }).click();
    await settles(page, /\/api\/views\//, async () => {
      await page.getByTestId("filter-box").fill("2026-10-01");
      await page.getByTestId("filter-box").press("Enter");
    });

    await expect(chip(page, "Due is before 2026-10-01")).toBeVisible();
    await expect(card(page, "Due soon")).toBeVisible();
    await expect(card(page, "Due later")).toHaveCount(0);

    // It survives the round trip, empty start and all.
    await page.goto(`/p/${projectId}`);
    await expect(chip(page, "Due is before 2026-10-01")).toBeVisible();
  });

  /* This is the whole point of the two steps. */
  test("picking a property asks a question and hides nothing", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Asking"));

    await addTask(page, "Todo", "Urgent thing");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addTask(page, "Todo", "Ordinary thing");
    await page.getByRole("button", { name: "Close task" }).click();

    await page.getByTestId("filter-button").click();
    const search = page.getByTestId("filter-search");
    await search.fill("Priority");
    await search.press("Enter");

    // The board must not have guessed an answer. Nothing is hidden, no chip
    // exists, and the line is only holding its space open.
    await expect(page.getByTestId("filter-chip")).toHaveCount(0);
    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");
    await expect(card(page, "Ordinary thing")).toBeVisible();

    // The arrow keys walk the values; Enter takes the one under them.
    const box = page.getByTestId("filter-box");
    await expect(box).toBeFocused();
    await settles(page, /\/api\/views\//, () => box.press("Enter"));
    await expect(chip(page, "Priority is Urgent")).toBeVisible();
    await expect(card(page, "Ordinary thing")).toHaveCount(0);

    // The panel stays open, because a set rule usually names more than one.
    await expect(page.getByTestId("filter-menu")).toBeVisible();
    await box.press("ArrowDown");
    await settles(page, /\/api\/views\//, () => box.press("Enter"));
    await expect(chip(page, "Priority is Urgent, High")).toBeVisible();

    // ‹ goes back to the property list without touching the rule.
    await page.getByRole("button", { name: /Pick another property/ }).click();
    await expect(page.getByTestId("filter-search")).toBeVisible();
    await expect(chip(page, "Priority is Urgent, High")).toBeVisible();
  });

  test("a rule whose option is deleted goes with it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Deleting"));

    await addTask(page, "Todo", "Only task");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addFilter(page, "Priority", "Urgent");
    await expect(chip(page, "Priority is Urgent")).toBeVisible();

    await page.goto(`/p/${projectId}/settings/properties`);
    // An option goes at once. Only a whole property asks first.
    await settles(page, /\/api\/options\//, () =>
      page.getByRole("button", { name: "Delete the option Urgent" }).click(),
    );

    // The rule named one option and that option has gone, so the rule has
    // nothing left to ask. A filter nobody can see must not keep hiding cards.
    await page.goto(`/p/${projectId}`);
    await expect(page.getByTestId("filter-row")).toHaveCount(0);
    await expect(card(page, "Only task")).toBeVisible();
  });
});
