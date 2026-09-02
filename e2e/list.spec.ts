import { expect, test } from "@playwright/test";
import {
  addFilter,
  addListView,
  addTask,
  column,
  createProject,
  gotoSettings,
  listHead,
  listOrder,
  listRow,
  register,
  saved,
  settles,
  unique,
  viewKind,
} from "./helpers";

/** The board this file works on: three tasks, in a known order. */
async function threeTasks(page: import("@playwright/test").Page) {
  await addTask(page, "Todo", "First thing");
  await page.getByRole("button", { name: "Close task" }).click();
  await addTask(page, "Todo", "Second thing");
  await page.getByRole("button", { name: "Close task" }).click();
  await addTask(page, "Backlog", "Third thing");
  await page.getByRole("button", { name: "Close task" }).click();
}

test.describe("A list view", () => {
  test("shows every task the board shows, in the one order they share", async ({ page }) => {
    await register(page);
    await createProject(page, unique("List"));
    await threeTasks(page);

    await addListView(page, "Everything");

    // The columns are gone; the rows are all here, in the board's own order.
    await expect(page.getByTestId("column")).toHaveCount(0);
    expect(await listOrder(page)).toEqual(["First thing", "Second thing", "Third thing"]);
    await expect(page.getByTestId("task-count")).toHaveText("3 tasks");
  });

  test("does not ask what to group by, because it groups nothing", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Ask"));

    await page.getByRole("button", { name: "New view" }).click();
    await expect(page.getByText("Columns by")).toBeVisible();

    await viewKind(page, "List").click();
    await expect(page.getByText("Columns by")).toHaveCount(0);
    await expect(
      page.getByText("One row for each task, in the order the board already has."),
    ).toBeVisible();

    // And back again: the question returns with its answer still chosen.
    await viewKind(page, "Board").click();
    await expect(page.getByText("Columns by")).toBeVisible();
  });

  test("carries the same chips a card does, and follows the card view", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Chips"));
    await addTask(page, "Todo", "Wears a priority");
    await page.getByRole("button", { name: "Urgent" }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addListView(page, "Rows");
    await expect(listRow(page, "Wears a priority").getByText("Urgent")).toBeVisible();

    // Take Priority off the card and it leaves the list in the same breath:
    // one card view, two drawings.
    await gotoSettings(page, projectId, "card");
    await page.getByRole("button", { name: /^Priority on the card/ }).click();
    await saved(page, () => page.getByRole("button", { name: "Take off the card" }).click());

    await page.goto(`/p/${projectId}`);
    await expect(page.getByTestId("list-view")).toBeVisible();
    await expect(listRow(page, "Wears a priority").getByText("Urgent")).toHaveCount(0);
  });

  test("keeps its columns when it becomes a board and comes back", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Switch"));
    await gotoSettings(page, projectId, "views");

    const row = page.getByLabel("How the view Phases shows");
    await expect(row).toHaveValue("board");
    await expect(page.getByLabel("Grouping property of the view Phases")).toHaveValue(/.+/);
    const phaseProperty = await page
      .getByLabel("Grouping property of the view Phases")
      .inputValue();

    // Becoming a list takes the question away and asks nothing before it does.
    await saved(page, async () => {
      await row.selectOption("list");
    });
    await expect(page.getByLabel("Grouping property of the view Phases")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Yes, / })).toHaveCount(0);

    // And back: the same property, remembered.
    await saved(page, async () => {
      await row.selectOption("board");
    });
    await expect(page.getByLabel("Grouping property of the view Phases")).toHaveValue(
      phaseProperty,
    );
  });

  test("moves a row, and the board sees the same order", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Order"));
    await threeTasks(page);
    await addListView(page, "Order");

    const third = listRow(page, "Third thing");
    const first = listRow(page, "First thing");
    const from = await third.boundingBox();
    const to = await first.boundingBox();

    await page.mouse.move(from!.x + 200, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(from!.x + 208, from!.y + from!.height / 2 - 6, { steps: 5 });
    for (let i = 1; i <= 18; i += 1) {
      await page.mouse.move(
        from!.x + 200,
        from!.y + from!.height / 2 + ((to!.y - from!.y) * i) / 18,
      );
    }
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/move$/, () => page.mouse.up());

    expect(await listOrder(page)).toEqual(["Third thing", "First thing", "Second thing"]);

    // One order, shared by every view. The board is the proof.
    await page.reload();
    await expect(page.getByTestId("list-view")).toBeVisible();
    expect(await listOrder(page)).toEqual(["Third thing", "First thing", "Second thing"]);

    await page.getByTestId("view-pill").filter({ hasText: "Board" }).click();
    const todo = column(page, "Todo").getByTestId("card-title");
    await expect(todo).toHaveText(["First thing", "Second thing"]);
  });

  test("has one tab stop, and the arrow keys walk it", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Keys"));
    await threeTasks(page);
    await addListView(page, "Keys");

    // dnd-kit hands every row a stop. The list keeps one.
    await expect(page.locator('[data-testid="list-row"][tabindex="0"]')).toHaveCount(1);

    await listRow(page, "First thing").click();
    await page.getByRole("button", { name: "Close task" }).click();
    await listRow(page, "First thing").focus();

    await page.keyboard.press("ArrowDown");
    await expect(listRow(page, "Second thing")).toBeFocused();
    await page.keyboard.press("End");
    await expect(listRow(page, "Third thing")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(listRow(page, "Third thing")).toBeFocused(); // nothing wraps
    await page.keyboard.press("Home");
    await expect(listRow(page, "First thing")).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /^Comments/ })).toBeVisible();
  });

  test("moves a row with the keyboard alone", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Lift"));
    await threeTasks(page);
    await addListView(page, "Lift");

    await listRow(page, "First thing").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("list-row-overlay")).toBeVisible();
    // dnd-kit measures the rows in an effect that runs after the drag-start
    // render, and the arrow key needs those measurements. This test can press
    // it about five milliseconds after the row lifts, which no person can do.
    // So wait as a person waits.
    await page.waitForTimeout(150);

    // A board shows the card in its new column before the drop is committed,
    // and the test can wait for that. A list reorders by transform and its DOM
    // order does not change, so the thing to wait for is the lifted row
    // arriving over the row below it.
    const overlay = page.getByTestId("list-row-overlay");
    const lifted = (await overlay.boundingBox())!.y;
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await overlay.boundingBox())!.y).toBeGreaterThan(lifted + 8);

    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/move$/, () => page.keyboard.press("Space"));

    expect(await listOrder(page)).toEqual(["Second thing", "First thing", "Third thing"]);
    // Dropping must not also open the task.
    await expect(page.getByTestId("task-panel")).toHaveCount(0);
  });

  test("a task added under a filter is not hidden by it", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Seed"));
    await addTask(page, "Todo", "Already here");
    await page.getByRole("button", { name: "Urgent" }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addListView(page, "Urgent only");

    await addFilter(page, "Priority", "Urgent");
    await expect(page.getByTestId("task-count")).toHaveText("1 task");

    // The composer says what it is about to write, and then writes it, so the
    // new row survives the filter it was born into.
    await page.getByTestId("list-add").click();
    await expect(page.getByText("sets Priority Urgent")).toBeVisible();
    const input = page.getByPlaceholder("What needs doing?");
    await input.fill("Born urgent");
    await input.press("Enter");

    await expect(listRow(page, "Born urgent")).toBeVisible();
    // Both pass, so the strip has no "of" to report.
    await expect(page.getByTestId("task-count")).toHaveText("2 tasks");
  });

  test("still offers a row to add when a filter hides everything", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Blank"));
    await addTask(page, "Todo", "The only one");
    await page.getByRole("button", { name: "Close task" }).click();
    await addListView(page, "Nothing");

    await addFilter(page, "Priority", "Urgent");

    await expect(page.getByText("No task passes the filter.")).toBeVisible();
    await expect(page.getByTestId("list-row")).toHaveCount(0);
    // The header and the way out both stay.
    await expect(page.getByTestId("list-head")).toBeVisible();
    await expect(page.getByTestId("list-add")).toBeVisible();
  });

  test("can be made on a project with nothing to group by", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Ungroupable"));

    // Take away every property a board could use for its columns. The two
    // default boards have to go first, since a board without them is nothing.
    await gotoSettings(page, projectId, "views");
    for (const name of ["Phases"]) {
      await page.getByRole("button", { name: `Delete the view ${name}` }).click();
      await page.getByRole("button", { name: /^Yes, / }).click();
    }
    // The main view cannot be deleted, so it becomes a list instead.
    await saved(page, async () => {
      await page.getByLabel("How the view Board shows").selectOption("list");
    });

    await gotoSettings(page, projectId, "properties");
    for (const name of ["Status", "Assignee", "Phase"]) {
      await page.getByRole("button", { name: `Delete the property ${name}` }).click();
      await page.getByRole("button", { name: /^Yes, / }).click();
      await expect(page.getByLabel(`Name of the ${name} property`)).toHaveCount(0);
    }

    await page.goto(`/p/${projectId}`);
    await expect(page.getByTestId("list-view")).toBeVisible();

    // The + used to be a dead end here. A list needs no property to group by.
    await page.getByRole("button", { name: "New view" }).click();
    await page.getByLabel("Name of the new view").fill("Second list");
    await viewKind(page, "List").click();
    await page.getByRole("button", { name: "Create view" }).click();
    await expect(page.getByTestId("view-pill").filter({ hasText: "Second list" })).toBeVisible();
    await expect(page.getByTestId("list-view")).toBeVisible();
  });

  test("does not pin the property it once grouped by", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Unpin"));
    await gotoSettings(page, projectId, "views");
    await saved(page, async () => {
      await page.getByLabel("How the view Phases shows").selectOption("list");
    });

    // A board would refuse this. A list remembers the property but never reads
    // one, and a remembered word must not hold a property nobody is using.
    await gotoSettings(page, projectId, "properties");
    await page.getByRole("button", { name: "Delete the property Phase" }).click();
    await page.getByRole("button", { name: /^Yes, / }).click();
    await expect(page.getByLabel("Name of the Phase property")).toHaveCount(0);
  });

  test("orders itself by a column, and gives the board's own order back", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Sort"));

    await addTask(page, "Todo", "Middling");
    await page.getByRole("button", { name: "Medium", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "Todo", "The worst of it");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "Todo", "Can wait");
    await page.getByRole("button", { name: "Low", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await addListView(page, "Sorted");
    const asAdded = ["Middling", "The worst of it", "Can wait"];
    expect(await listOrder(page)).toEqual(asAdded);

    // Options are ordered by hand and that order is the meaning: Urgent above
    // Low, not alphabetically.
    await settles(page, /\/api\/views\//, () => listHead(page, "Priority").click());
    expect(await listOrder(page)).toEqual(["The worst of it", "Middling", "Can wait"]);

    await settles(page, /\/api\/views\//, () => listHead(page, "Priority").click());
    expect(await listOrder(page)).toEqual(["Can wait", "Middling", "The worst of it"]);

    // The third press is the way back to the order a drag can write.
    await settles(page, /\/api\/views\//, () => listHead(page, "Priority").click());
    expect(await listOrder(page)).toEqual(asAdded);
    await expect(page.getByTestId("sort-chip")).toHaveCount(0);
  });

  test("holds its order across a reload, and says it is holding one", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Holds"));
    await threeTasks(page);
    await addListView(page, "Held");

    await settles(page, /\/api\/views\//, () => listHead(page, "Title").click());
    const sorted = await listOrder(page);
    expect(sorted).toEqual(["First thing", "Second thing", "Third thing"].sort());

    await expect(page.getByTestId("sort-chip")).toContainText("Title");

    await page.reload();
    await expect(page.getByTestId("list-view")).toBeVisible();
    expect(await listOrder(page)).toEqual(sorted);
    await expect(page.getByTestId("sort-chip")).toContainText("Title");

    // The chip is the other way out, and it leaves the drag working again.
    await settles(page, /\/api\/views\//, () => page.getByTestId("sort-clear").click());
    await expect(page.getByTestId("sort-chip")).toHaveCount(0);
    expect(await listOrder(page)).toEqual(["First thing", "Second thing", "Third thing"]);
  });

  test("cannot be dragged while it is holding an order", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Frozen"));
    await threeTasks(page);
    await addListView(page, "Frozen");

    await settles(page, /\/api\/views\//, () => listHead(page, "Title").click());
    const before = await listOrder(page);

    // A drag would write a rank into a list that is not showing ranks, so the
    // rows are held still. Space does not lift one either.
    await listRow(page, before[2]).focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(250);
    await expect(page.getByTestId("list-row-overlay")).toHaveCount(0);
    expect(await listOrder(page)).toEqual(before);

    // And with the order given back, it lifts again.
    await settles(page, /\/api\/views\//, () => page.getByTestId("sort-clear").click());
    await listRow(page, "First thing").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("list-row-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("the order belongs to the view, not to the board underneath", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Mine"));
    await threeTasks(page);
    await addListView(page, "Mine");

    await settles(page, /\/api\/views\//, () => listHead(page, "Title").click());
    expect(await listOrder(page)).toEqual(["First thing", "Second thing", "Third thing"].sort());

    // A sort writes nothing. The rank underneath is untouched, so the board
    // shows exactly what it showed before.
    await page.getByTestId("view-pill").filter({ hasText: "Board" }).first().click();
    await expect(column(page, "Todo").getByTestId("card-title")).toHaveText([
      "First thing",
      "Second thing",
    ]);
  });

  test("opens a task beside it, and the panel wears the row's colour", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Panel"));
    await addTask(page, "Todo", "Open me");
    await page.getByRole("button", { name: "Close task" }).click();
    await addListView(page, "Panel");

    await listRow(page, "Open me").click();
    await expect(page.getByTestId("task-title")).toHaveValue("Open me");
    // The list is still there beside it, not replaced by the panel.
    await expect(page.getByTestId("list-view")).toBeVisible();
    await expect(listRow(page, "Open me")).toBeVisible();
  });
});
