import { expect, test } from "@playwright/test";
import { addListView, addTask, card, createProject, listRow, register, unique } from "./helpers";

/*
 * The task panel and the view strip, read by a keyboard and by a screen
 * reader. A keyboard that opens a task lands on it, and lands back on the
 * card when it closes; every field says which property it is.
 */
test.describe("The panel and the view strip work without a mouse", () => {
  test("the focus goes to the title on open and back to the card on close", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Focus"));
    await addTask(page, "Todo", "First to read");
    await addTask(page, "Todo", "Second to read");

    const panel = page.getByTestId("task-panel");
    const title = page.getByTestId("task-title");

    // A new task opens on its title, so the words can be read at once.
    await expect(title).toBeFocused();
    await expect(title).toHaveValue("Second to read");

    // One Escape closes a panel nobody has typed in, and the card has the focus.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(card(page, "Second to read")).toBeFocused();

    // Enter on the card opens it again, on the title.
    await page.keyboard.press("Enter");
    await expect(title).toBeFocused();
    await expect(title).toHaveValue("Second to read");

    // The close button gives the focus back the same way.
    await page.getByRole("button", { name: "Close task" }).click();
    await expect(panel).toHaveCount(0);
    await expect(card(page, "Second to read")).toBeFocused();

    // A card opened by a click is the card the focus comes back to.
    await card(page, "First to read").click();
    await expect(title).toHaveValue("First to read");
    await expect(title).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(card(page, "First to read")).toBeFocused();

    // The board still has one tab stop, and it is that card.
    const tabStop = page.locator('[data-testid="card"][tabindex="0"]');
    await expect(tabStop).toHaveCount(1);
    await expect(tabStop).toContainText("First to read");
  });

  test("each field is named by its label, and the menus say they are open", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Names"));
    await addTask(page, "Todo", "Named fields");
    const panel = page.getByTestId("task-panel");

    // A menu is read with its label, not as "No status, button".
    const status = panel.getByRole("button", { name: "Status Todo", exact: true });
    await expect(status).toHaveAttribute("aria-expanded", "false");
    await status.click();
    await expect(status).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("listbox", { name: "Status" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel.getByRole("listbox", { name: "Status" })).toHaveCount(0);
    await expect(status).toBeFocused();

    // A row of options is a group named by its label, and the chosen one is pressed.
    const priority = panel.getByRole("group", { name: "Priority", exact: true });
    await priority.getByRole("button", { name: "High" }).click();
    await expect(priority.getByRole("button", { name: "High" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // The person menu is a list of options, and the arrows walk it.
    const assignee = panel.getByRole("button", { name: "Assignee Unassigned", exact: true });
    await assignee.click();
    const people = panel.getByRole("listbox", { name: "Assignee" });
    await expect(people.getByRole("option", { name: "Unassigned", exact: true })).toBeFocused();
    await expect(people.getByRole("option", { name: "Unassigned", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("ArrowDown");
    const me = people.getByRole("option", { name: "Test Person", exact: true });
    await expect(me).toBeFocused();
    // The list is one tab stop: the arrows walk it, and one Tab leaves it.
    await expect(people.locator('[role="option"][tabindex="0"]')).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(people.locator(":focus")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(people).toHaveCount(0);
    // Pick with Enter, and the field reads the person by name alone.
    await assignee.click();
    await expect(people.getByRole("option", { name: "Unassigned", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const assigned = panel.getByRole("button", { name: "Assignee Test Person", exact: true });
    await expect(assigned).toBeFocused();
    await assigned.click();
    await page.keyboard.press("Escape");
    await expect(assigned).toBeFocused();
    // The menu took that Escape, so the panel is still open.
    await expect(panel).toBeVisible();
  });

  test("a list gives the focus back to the row that was open", async ({ page }) => {
    await register(page);
    await createProject(page, unique("List focus"));
    await addTask(page, "Todo", "Row one");
    await addTask(page, "Todo", "Row two");
    await page.getByRole("button", { name: "Close task" }).click();
    await addListView(page, "Rows");

    const first = listRow(page, "Row one");
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("task-title")).toBeFocused();
    await expect(page.getByTestId("task-title")).toHaveValue("Row one");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-panel")).toHaveCount(0);
    await expect(first).toBeFocused();
    const tabStop = page.locator('[data-testid="list-row"][tabindex="0"]');
    await expect(tabStop).toHaveCount(1);
    await expect(tabStop).toContainText("Row one");
  });

  test("the panel's tabs are tabs, and the arrows move between them", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Tabs"));
    await addTask(page, "Todo", "Tabbed task");
    const panel = page.getByTestId("task-panel");

    await expect(panel.getByRole("tablist")).toBeVisible();
    const comments = panel.getByRole("tab", { name: /^Comments/ });
    const activity = panel.getByRole("tab", { name: /^Activity/ });
    await expect(comments).toHaveAttribute("aria-selected", "true");
    await expect(activity).toHaveAttribute("aria-selected", "false");
    await expect(panel.getByRole("tabpanel", { name: /^Comments/ })).toBeVisible();

    await comments.focus();
    await page.keyboard.press("ArrowRight");
    await expect(activity).toBeFocused();
    await expect(activity).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("tabpanel", { name: /^Activity/ })).toBeVisible();
  });

  test("the view strip names the view it is on", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Pills"));

    const pills = page.getByTestId("view-pill");
    const active = pills.and(page.locator('[aria-current="true"]'));
    await expect(active).toHaveCount(1);
    const name = ((await active.textContent()) ?? "").trim();
    await expect(active).toHaveAttribute("title", name);
    // The strip has no keyboard drag, so it does not offer one.
    await expect(active).not.toHaveAttribute("aria-roledescription", /./);
    await expect(active).not.toHaveAttribute("aria-describedby", /./);

    // The chips that pick the columns of a new view say which one is chosen.
    await page.getByRole("button", { name: "New view" }).click();
    const columnsBy = page.getByRole("group", { name: "Columns by" });
    const chips = columnsBy.getByRole("button");
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(chips.first()).toHaveAttribute("aria-pressed", "false");
  });

  test("an error toast is an alert", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Alert"));
    await addTask(page, "Todo", "Will not save");

    await page.route("**/api/tasks/*/values/*", (route) =>
      route.fulfill({ status: 500, json: { error: "The change did not save." } }),
    );
    const panel = page.getByTestId("task-panel");
    await panel
      .getByRole("group", { name: "Priority" })
      .getByRole("button", { name: "Low" })
      .click();
    await expect(page.getByRole("alert").filter({ hasText: "did not save" })).toBeVisible();
  });
});
