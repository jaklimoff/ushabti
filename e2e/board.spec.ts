import { expect, test } from "@playwright/test";
import {
  addTask,
  card,
  centreOf,
  column,
  createProject,
  dragCard,
  register,
  settles,
  unique,
} from "./helpers";

test.describe("Ushabti board", () => {
  test("sign up, create a project and get the default properties", async ({ page }) => {
    await register(page, "Ada Lovelace");
    await createProject(page, unique("Roadmap"));

    for (const name of ["BACKLOG", "TODO", "IN PROGRESS", "READY", "SHIPPED"]) {
      await expect(column(page, name)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /^Board/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Phases/ })).toBeVisible();
  });

  test("a full column scrolls and its cards keep their height", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Overflow"));

    for (let i = 1; i <= 14; i += 1) {
      await addTask(page, "Backlog", `Overflow card ${i}`);
      await page.getByRole("button", { name: "Close task" }).click();
    }

    const backlog = column(page, "Backlog");
    const body = backlog.getByTestId("column-body");
    const size = await body.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }));
    // The body scrolls. A card clips its own overflow, so a flex column would
    // sooner squash every card to nothing than let this happen.
    expect(size.scroll).toBeGreaterThan(size.client);

    const first = await backlog.getByTestId("card").first().boundingBox();
    expect(first!.height).toBeGreaterThan(40);
  });

  test("add a task, open it and edit every part", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Editing"));

    await addTask(page, "Todo", "Write the first task");
    // The panel opens by itself after the task is created.
    await expect(page.getByRole("button", { name: /^Comments/ })).toBeVisible();

    // title
    const title = page.getByTestId("task-title");
    await title.click();
    await title.fill("Write the first task, renamed");
    await title.press("Enter");
    await expect(card(page, "Write the first task, renamed").first()).toBeVisible();

    // description with markdown
    await page.getByText("Add a description…").click();
    const editor = page.getByPlaceholder("Write in markdown…");
    await editor.fill("Ships **offline** first.\n\n- one\n- two");
    await editor.blur();
    await expect(page.getByTestId("markdown").locator("strong")).toHaveText("offline");
    await expect(page.getByTestId("markdown").locator("li")).toHaveCount(2);

    // checklist
    await page.getByRole("button", { name: "Add item" }).click();
    const item = page.getByPlaceholder("What has to be true?");
    await item.fill("Queue survives a reload");
    await item.press("Enter");
    await expect(page.getByText("Queue survives a reload")).toBeVisible();
    await page.getByRole("button", { name: "Mark as done" }).first().click();
    await expect(page.getByText("1 / 1")).toBeVisible();

    // comment
    const composer = page.getByPlaceholder("Leave a note…");
    await composer.fill("Looks right to me.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText("Looks right to me.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Comments 1/ })).toBeVisible();

    // activity
    await page.getByRole("button", { name: /^Activity/ }).click();
    await expect(page.getByText(/created the task/)).toBeVisible();
  });

  test("set a property from the panel and see it on the card", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Props"));
    await addTask(page, "Todo", "Priority test");

    await page.getByRole("button", { name: "Urgent" }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    const square = card(page, "Priority test").getByTestId("card-chip").first();
    await expect(square).toHaveAttribute("title", "Priority · Urgent");
  });

  test("drag a card into another column and it stays there", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Drag"));
    await addTask(page, "Todo", "Move me across");
    await page.getByRole("button", { name: "Close task" }).click();

    await expect(column(page, "Todo").getByTestId("card")).toHaveCount(1);

    await dragCard(page, "Move me across", await centreOf(page, "In Progress"));

    await expect(column(page, "In Progress").getByTestId("card")).toHaveCount(1);
    await expect(column(page, "Todo").getByTestId("card")).toHaveCount(0);

    // and it survives a reload, so the move reached the database
    await page.goto(`/p/${projectId}`);
    await expect(column(page, "In Progress").getByText("Move me across")).toBeVisible();
  });

  test("drag a card into an empty column while other columns are full", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Empty column"));

    // Backlog is left empty, and the columns beside it are filled. A card is
    // a much smaller drop target than a column, so unless the pointer decides
    // the target, a card next door wins and the empty column never takes a drop.
    for (const title of ["Todo one", "Todo two", "Todo three"]) {
      await addTask(page, "Todo", title);
      await page.getByRole("button", { name: "Close task" }).click();
    }
    await expect(column(page, "Backlog").getByTestId("card")).toHaveCount(0);

    await dragCard(page, "Todo one", await centreOf(page, "Backlog"));

    await expect(column(page, "Backlog").getByTestId("card")).toHaveCount(1);
    await expect(column(page, "Todo").getByTestId("card")).toHaveCount(2);

    await page.goto(`/p/${projectId}`);
    await expect(column(page, "Backlog").getByText("Todo one")).toBeVisible();
  });

  test("drag a card onto the free space under a column and it goes last", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Drop below"));
    for (const title of ["First card", "Second card", "Third card"]) {
      await addTask(page, "Todo", title);
      await page.getByRole("button", { name: "Close task" }).click();
    }

    const titles = async () =>
      (await column(page, "Todo").getByTestId("card-title").allInnerTexts()).map((t) => t.trim());

    const last = await card(page, "Third card").first().boundingBox();
    if (!last) throw new Error("cards not found");
    await dragCard(page, "First card", {
      x: last.x + last.width / 2,
      y: last.y + last.height + 40,
    });

    expect(await titles()).toEqual(["Second card", "Third card", "First card"]);

    await page.goto(`/p/${projectId}`);
    expect(await titles()).toEqual(["Second card", "Third card", "First card"]);
  });

  test("drag reorders cards inside one column", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Reorder"));
    for (const title of ["First card", "Second card", "Third card"]) {
      await addTask(page, "Todo", title);
      await page.getByRole("button", { name: "Close task" }).click();
    }

    const titles = async () =>
      (await column(page, "Todo").getByTestId("card-title").allInnerTexts()).map((t) => t.trim());

    expect(await titles()).toEqual(["First card", "Second card", "Third card"]);

    const third = await card(page, "Third card").first().boundingBox();
    const first = await card(page, "First card").first().boundingBox();
    if (!third || !first) throw new Error("cards not found");
    await dragCard(page, "Third card", { x: first.x + first.width / 2, y: first.y + 6 });

    expect(await titles()).toEqual(["Third card", "First card", "Second card"]);

    await page.goto(`/p/${projectId}`);
    expect(await titles()).toEqual(["Third card", "First card", "Second card"]);
  });

  test("checklist and comment counts reach the card and survive a reload", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Counts"));
    await addTask(page, "Todo", "Counting task");

    await page.getByRole("button", { name: "Add item" }).click();
    const item = page.getByPlaceholder("What has to be true?");
    await item.fill("First thing");
    await item.press("Enter");
    await item.fill("Second thing");
    await item.press("Enter");
    await page.getByRole("button", { name: "Mark as done" }).first().click();

    const composer = page.getByPlaceholder("Leave a note…");
    await composer.fill("A note.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText("A note.")).toBeVisible();

    await page.getByRole("button", { name: "Close task" }).click();

    // no reload: the card behind the panel already carries the counts
    const target = card(page, "Counting task").first();
    await expect(target).toContainText("1/2");
    await expect(target).toContainText("1");

    // and again from the board the server draws, which counts them itself
    await page.goto(`/p/${projectId}`);
    const drawn = card(page, "Counting task").first();
    await expect(drawn).toContainText("1/2");
    await expect(drawn.getByTitle("Comments")).toHaveText("1");
  });

  test("a card moves with the keyboard alone", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Keyboard"));
    await addTask(page, "Todo", "Keyboard move");
    await page.getByRole("button", { name: "Close task" }).click();

    await card(page, "Keyboard move").first().focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("card-overlay")).toBeVisible();
    // dnd-kit measures the columns in an effect that runs after the drag-start
    // render, and the arrow key needs those measurements to know what is to the
    // right. This test can press it about five milliseconds after the card
    // lifts, which no person can do, and it then reads rectangles that are not
    // there yet. Against `next dev` the server was slow enough to hide it; the
    // production build is not. So wait as a person waits.
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
    // the board shows the card in its new column before the drop is committed
    await expect(column(page, "In Progress").getByText("Keyboard move")).toBeVisible();
    // The drop writes without waiting, so the reload below can outrun it.
    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/move$/, () => page.keyboard.press("Space"));

    await expect(column(page, "In Progress").getByText("Keyboard move")).toBeVisible();
    // dropping must not also open the task
    await expect(page.getByTestId("task-panel")).toHaveCount(0);

    await page.goto(`/p/${projectId}`);
    await expect(column(page, "In Progress").getByText("Keyboard move")).toBeVisible();

    // Enter still opens the task
    await card(page, "Keyboard move").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("task-panel")).toBeVisible();
  });

  test("a lifted card lands in the empty column beside it, not past it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Gap"));
    await addTask(page, "Backlog", "Goes next door");
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "In Progress", "Already there");
    await page.getByRole("button", { name: "Close task" }).click();

    await card(page, "Goes next door").first().focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("card-overlay")).toBeVisible();
    // the columns are measured in an effect after the lift; see the test above
    await page.waitForTimeout(150);

    // Todo holds no cards. Scored by its corners it is as tall as the board, so
    // the small card two columns over used to win and the lift jumped the gap.
    await page.keyboard.press("ArrowRight");
    await expect(column(page, "Todo").getByText("Goes next door")).toBeVisible();

    // One column at a time, and back again.
    await page.keyboard.press("ArrowRight");
    await expect(column(page, "In Progress").getByText("Goes next door")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(column(page, "Todo").getByText("Goes next door")).toBeVisible();

    await settles(page, /\/api\/tasks\/[0-9a-f-]+\/move$/, () => page.keyboard.press("Space"));
    await page.goto(`/p/${projectId}`);
    await expect(column(page, "Todo").getByText("Goes next door")).toBeVisible();
  });

  test("the arrow keys move the cursor from card to card", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Cursor"));

    const written = [
      ["Backlog", "Top of the pile"],
      ["Backlog", "Under it"],
      ["In Progress", "Two columns over"],
    ] as const;
    for (const [columnName, title] of written) {
      await addTask(page, columnName, title);
      await page.getByRole("button", { name: "Close task" }).click();
    }

    // The whole board is one tab stop, not one for every card.
    const tabStop = page.locator('[data-testid="card"][tabindex="0"]');
    await expect(tabStop).toHaveCount(1);
    await expect(tabStop).toContainText("Top of the pile");

    await card(page, "Top of the pile").first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(card(page, "Under it").first()).toBeFocused();

    // Todo holds no cards, so the cursor steps over it, and it takes the tab
    // stop with it.
    await page.keyboard.press("ArrowRight");
    await expect(card(page, "Two columns over").first()).toBeFocused();
    await expect(tabStop).toContainText("Two columns over");

    // Coming back the row is clamped to what the column has.
    await page.keyboard.press("ArrowLeft");
    await expect(card(page, "Top of the pile").first()).toBeFocused();

    // The top of a column is the end of the road. End is its bottom.
    await page.keyboard.press("ArrowUp");
    await expect(card(page, "Top of the pile").first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(card(page, "Under it").first()).toBeFocused();

    // The cursor opens what it sits on.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(page.getByTestId("task-title")).toHaveValue("Under it");
  });

  test("copy the link to a task and open it again", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await register(page);
    const projectId = await createProject(page, unique("Links"));
    await addTask(page, "Todo", "Share me");

    const key = await page.getByTestId("task-key").innerText();
    await page.getByTestId("task-key").click();
    await expect(page.getByTestId("toast")).toHaveText("Link copied");

    // The link carries the key people read on the card, not the uuid.
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(`${new URL(page.url()).origin}/p/${projectId}?task=${key}`);

    // The link has to open the task on its own, in a window that never had
    // the board open.
    await page.goto("about:blank");
    await page.goto(link);
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(page.getByTestId("task-title")).toHaveValue("Share me");
  });

  test("the panel is as wide as somebody dragged it, and stays that wide", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Width"));
    await addTask(page, "Todo", "Room to read");

    const panel = page.getByTestId("task-panel");
    const grip = page.getByTestId("panel-grip");
    const was = (await panel.boundingBox())!.width;
    const edge = (await grip.boundingBox())!;

    // The panel grows to the left, so the pointer goes left.
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 240);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 - 140, edge.y + 240, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(async () => Math.round((await panel.boundingBox())!.width))
      .toBe(Math.round(was + 140));

    // The arrow keys move it too, so the width is not a mouse-only setting.
    await grip.focus();
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => Math.round((await panel.boundingBox())!.width))
      .toBe(Math.round(was + 156));

    // The next board this person opens is the width they left it.
    await page.reload();
    await expect(panel).toBeVisible();
    await expect
      .poll(async () => Math.round((await panel.boundingBox())!.width))
      .toBe(Math.round(was + 156));
  });

  test("create a view grouped by another property", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Views"));
    await addTask(page, "Todo", "Grouping test");
    await page.getByRole("button", { name: "Close task" }).click();

    await page.getByRole("button", { name: "New view" }).click();
    await page.getByPlaceholder("View name").fill("By owner");
    await page.getByRole("button", { name: "Assignee" }).click();
    await page.getByRole("button", { name: "Create view" }).click();

    await expect(page.getByTestId("view-pill").filter({ hasText: "By owner" })).toBeVisible();
    await expect(column(page, "Unassigned")).toBeVisible();
  });

  test("add a column, which is a new option on the grouping property", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Columns"));

    await page.getByRole("button", { name: "New column" }).click();
    await page.getByPlaceholder("Column name").fill("Blocked");
    await page.getByRole("button", { name: "Add column" }).click();

    await expect(column(page, "Blocked")).toBeVisible();
    await page.goto(`/p/${projectId}`);
    await expect(column(page, "Blocked")).toBeVisible();
  });
});
