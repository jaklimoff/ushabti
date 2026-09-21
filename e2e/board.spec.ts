import { expect, test } from "@playwright/test";
import {
  addListView,
  addTask,
  card,
  centreOf,
  column,
  columnOrder,
  columnPill,
  createProject,
  dragCard,
  dragOnto,
  forAFinger,
  overflow,
  pastTheBar,
  register,
  saved,
  settles,
  showColumn,
  sortBoard,
  unique,
  viewOrder,
} from "./helpers";

type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

/**
 * Three cards in Todo and one in Backlog, added in an order that is not the
 * order any priority puts them in.
 */
async function aPricedBoard(page: Page) {
  for (const [title, priority] of [
    ["Aardvark", "Low"],
    ["Beetle", "Urgent"],
    ["Cricket", ""],
  ] as const) {
    await addTask(page, "Todo", title);
    if (priority) await page.getByRole("button", { name: priority, exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();
  }
  await addTask(page, "Backlog", "Dingo");
  await page.getByRole("button", { name: "High", exact: true }).click();
  await page.getByRole("button", { name: "Close task" }).click();
}

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
    await composer.fill("Looks **right** to me.\n\n- one\n- two");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Comments 1/ })).toBeVisible();

    // a comment reads like a description: it is markdown too
    const posted = page.getByTestId("comment-markdown");
    await expect(posted.locator("strong")).toHaveText("right");
    await expect(posted.locator("li")).toHaveCount(2);

    // activity
    await page.getByRole("button", { name: /^Activity/ }).click();
    await expect(page.getByText(/created the task/)).toBeVisible();
  });

  test("Escape throws the edit away and writes nothing", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Escape"));
    await addTask(page, "Todo", "Keep the old title");

    // Something worth losing: a description that is already saved.
    await page.getByText("Add a description…").click();
    const editor = page.getByPlaceholder("Write in markdown…");
    await editor.fill("The words that were saved.");
    await settles(page, /\/api\/tasks\/[0-9a-f-]+$/, () => editor.blur());
    await expect(page.getByTestId("markdown")).toHaveText("The words that were saved.");

    const key = await page.getByTestId("task-key").innerText();

    // From here on the task must not be written to. The route counts what
    // goes out, because the screen alone cannot tell a write that was made
    // from one that was not.
    const writes: string[] = [];
    await page.route(/\/api\/tasks\/[0-9a-f-]+$/, async (route) => {
      const request = route.request();
      if (request.method() !== "GET") writes.push(`${request.method()} ${request.url()}`);
      await route.continue();
    });

    await page.getByTestId("markdown").click();
    await editor.fill("Words nobody asked to keep.");
    await editor.press("Escape");
    await expect(page.getByTestId("markdown")).toHaveText("The words that were saved.");

    const title = page.getByTestId("task-title");
    await title.click();
    await title.fill("A title nobody asked to keep");
    await title.press("Escape");

    // A write would already be in flight; give it the chance to arrive.
    await page.waitForTimeout(500);
    expect(writes).toEqual([]);

    // And the server agrees: the task still says what it said.
    await page.goto(`/p/${projectId}?task=${key}`);
    await expect(page.getByTestId("task-title")).toHaveValue("Keep the old title");
    await expect(page.getByTestId("markdown")).toHaveText("The words that were saved.");
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

  test("n opens a composer in the column the cursor is in", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("NewKey"));
    await addTask(page, "In Progress", "Where the cursor is");
    await page.getByRole("button", { name: "Close task" }).click();

    // The cursor is on a card in In Progress, so that is where n adds.
    await card(page, "Where the cursor is").first().focus();
    await page.keyboard.press("n");
    const input = page.getByPlaceholder("What needs doing?");
    await expect(input).toBeFocused();
    await expect(column(page, "In Progress").getByPlaceholder("What needs doing?")).toBeVisible();
    await input.fill("Made with n");
    await input.press("Enter");
    await expect(column(page, "In Progress").getByText("Made with n")).toBeVisible();

    // In a field, n is a letter. The panel opened on the new task; its title
    // takes the key, and no composer appears.
    const title = page.getByTestId("task-panel").getByRole("textbox").first();
    await title.focus();
    await page.keyboard.press("n");
    await expect(page.getByPlaceholder("What needs doing?")).toHaveCount(0);

    // Nothing focused: the cursor rests on the top card of the first column
    // that has one, and n follows it there.
    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Made with n").first()).toBeVisible();
    /* The cards are drawn by the server, so they are on screen before the
       board is hydrated — and `n` listens on the window, which nothing has
       yet. A key pressed in that gap lands nowhere, and the test could reach
       it in about ten milliseconds, which no person can. The live dot is the
       board saying it is connected, and its keys work from the render before
       that one. So wait as a person waits: for the board to be there. */
    await expect(page.getByTestId("live-dot")).toBeVisible();
    await page.keyboard.press("n");
    await expect(column(page, "In Progress").getByPlaceholder("What needs doing?")).toBeVisible();
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

  test("a pill is dragged along the strip, and the order keeps", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("PillOrder"));

    expect(await viewOrder(page)).toEqual(["BOARD", "PHASES"]);

    const pill = (name: string) => page.getByTestId("view-pill").filter({ hasText: name });
    await dragOnto(page, pill("Phases"), pill("Board"), /^\/api\/views\/[0-9a-f-]+$/);
    expect(await viewOrder(page)).toEqual(["PHASES", "BOARD"]);

    // A drag is not a click: the board still shows the view it was on, which
    // is the one with the Status columns and not the Phase ones.
    await expect(column(page, "Backlog")).toBeVisible();

    await page.goto(`/p/${projectId}`);
    expect(await viewOrder(page)).toEqual(["PHASES", "BOARD"]);
  });

  test("a column folds to a strip, takes a card, and opens again", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Folding"));

    await addTask(page, "Todo", "Fold me across");
    await page.getByRole("button", { name: "Close task" }).click();

    const shipped = column(page, "Shipped");
    const open = page.getByRole("button", { name: "Open the column Shipped" });

    await page.getByRole("button", { name: "Fold the column Shipped" }).click();
    await expect(open).toBeVisible();
    await expect(shipped.getByTestId("column-name")).toHaveText("Shipped");
    await expect(shipped.getByTestId("column-count")).toHaveText("0");

    // Giving the width back is the whole point of the fold.
    const strip = await shipped.boundingBox();
    expect(strip!.width).toBeLessThan(80);

    await page.goto(`/p/${projectId}`);
    await expect(open).toBeVisible();

    // A folded column is still a drop target, so nothing is lost on a strip.
    await dragCard(page, "Fold me across", await centreOf(page, "Shipped"));
    await expect(shipped.getByTestId("column-count")).toHaveText("1");
    await expect(column(page, "Todo").getByTestId("card")).toHaveCount(0);

    await open.click();
    await expect(shipped.getByText("Fold me across")).toBeVisible();

    /* A fold gives width back, and a phone has none to give: it draws one
       column, whole, and the strip above names the rest. So there is no way
       to fold one down there — and the fold this browser wrote is ignored
       rather than cleared, so the wider window gets it back. */
    await page.getByRole("button", { name: "Fold the column Shipped" }).click();
    await expect(open).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await expect(page.getByTestId("column")).toHaveCount(1);
    await expect(column(page, "Todo")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Fold the column / })).toHaveCount(0);
    await expect(page.getByTestId("column-pill")).toHaveCount(5);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(open).toBeVisible();
    await expect(page.getByTestId("column-pill")).toHaveCount(0);

    // The fold is this browser's and nothing about it reached the project.
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`/p/${projectId}`);
    await expect(shipped.getByRole("button", { name: "Add a task to Shipped" })).toBeVisible();
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

/* A board is ordered from a button, because it has no heading to press. What
   the order then means is the list's answer, read by the same file. */
test.describe("Ordering a board", () => {
  test("orders every column, and the cards hold still while it is on", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Ordered"));
    await aPricedBoard(page);

    expect(await columnOrder(page, "Todo")).toEqual(["Aardvark", "Beetle", "Cricket"]);

    // Every column is in the order, and a card with no priority goes last.
    await sortBoard(page, "Priority");
    await expect(page.getByTestId("sort-chip")).toContainText("Priority");
    expect(await columnOrder(page, "Todo")).toEqual(["Beetle", "Aardvark", "Cricket"]);

    /* The order the board reads back is not proof on its own: a write that
       went out and was then overtaken would read the same. So count what the
       held drags send. A drag moves a card with POST .../move, so every
       method but GET counts. */
    const writes: string[] = [];
    await page.route("**/api/tasks/**", (route) => {
      const asked = route.request();
      if (asked.method() !== "GET")
        writes.push(`${asked.method()} ${new URL(asked.url()).pathname}`);
      return route.continue();
    });

    // A drag inside a column writes a rank, and there is no rank on screen to
    // write. So the card goes back where the order has it.
    const beetle = await card(page, "Beetle").boundingBox();
    await dragCard(page, "Aardvark", { x: beetle!.x + beetle!.width / 2, y: beetle!.y + 10 }, null);
    expect(await columnOrder(page, "Todo")).toEqual(["Beetle", "Aardvark", "Cricket"]);

    // Nor do the arrows of a lifted card: they belong to the drag, and inside
    // a sorted column there is nowhere for them to take it.
    await card(page, "Aardvark").first().focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("card-overlay")).toBeVisible();
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Space");
    await expect(page.getByTestId("card-overlay")).toHaveCount(0);
    expect(await columnOrder(page, "Todo")).toEqual(["Beetle", "Aardvark", "Cricket"]);

    // Neither held drag wrote anything at all.
    expect(writes).toEqual([]);
    await page.unroute("**/api/tasks/**");

    // Another column still takes the card, because that writes the column's
    // value and no rank at all — and the order says where it lands, under a
    // card that was there first.
    await dragCard(
      page,
      "Aardvark",
      await centreOf(page, "Backlog"),
      /\/api\/tasks\/[0-9a-f-]+\/values\//,
    );
    expect(await columnOrder(page, "Backlog")).toEqual(["Dingo", "Aardvark"]);
    expect(await columnOrder(page, "Todo")).toEqual(["Beetle", "Cricket"]);

    // The ✕ gives the board its own order back, and it is the order it always
    // had: Aardvark is above Dingo again, so nothing the drags did wrote a
    // rank.
    await settles(page, /\/api\/views\/[0-9a-f-]+$/, () => page.getByTestId("sort-clear").click());
    await expect(page.getByTestId("sort-chip")).toHaveCount(0);
    expect(await columnOrder(page, "Backlog")).toEqual(["Aardvark", "Dingo"]);
    expect(await columnOrder(page, "Todo")).toEqual(["Beetle", "Cricket"]);
  });

  test("the same press turns it around, and it holds across a reload", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Around"));
    await aPricedBoard(page);

    await sortBoard(page, "Priority");
    expect(await columnOrder(page, "Todo")).toEqual(["Beetle", "Aardvark", "Cricket"]);

    // Again for the other way. Nothing holds a card with no priority at the
    // top, whichever way the order runs.
    await sortBoard(page, "Priority");
    expect(await columnOrder(page, "Todo")).toEqual(["Aardvark", "Beetle", "Cricket"]);

    await page.goto(`/p/${projectId}`);
    await expect(page.getByTestId("sort-chip")).toContainText("Priority");
    expect(await columnOrder(page, "Todo")).toEqual(["Aardvark", "Beetle", "Cricket"]);

    // A third press is the way back, exactly as a heading's third press is.
    await sortBoard(page, "Priority");
    await expect(page.getByTestId("sort-chip")).toHaveCount(0);
    expect(await columnOrder(page, "Todo")).toEqual(["Aardvark", "Beetle", "Cricket"]);
  });

  test("a list is ordered by its headings, so it has no button", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Headings"));
    await addTask(page, "Todo", "Only one");
    await page.getByRole("button", { name: "Close task" }).click();

    await expect(page.getByTestId("sort-button")).toBeVisible();
    await addListView(page, "Rows");
    await expect(page.getByTestId("sort-button")).toHaveCount(0);
  });
});

/* The button reaches a phone, so its panel has to fit on one. */
test.describe("Ordering a board on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("the button is in the strip and its panel fits the screen", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Pocket"));
    await aPricedBoard(page);

    await expect(page.getByTestId("sort-button")).toBeVisible();
    // Nothing in the view strip is pushed off the side of the screen.
    for (const testid of ["sort-button", "filter-button", "task-count"]) {
      const box = await page.getByTestId(testid).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }

    await sortBoard(page, "Priority");
    /* A phone draws one column, and the cards that were ordered are in Todo. */
    await showColumn(page, "Todo");
    expect(await columnOrder(page, "Todo")).toEqual(["Beetle", "Aardvark", "Cricket"]);
    await expect(page.getByTestId("sort-chip")).toBeVisible();
  });

  /*
   * The top bar is exactly full at this width: the spacer between the name and
   * the search box has nothing left to give. So one more link would push the
   * bar off the side, and the mark — which is all that names the project down
   * here — would be squashed, both of them without a sound.
   */
  test("the top bar fits, and the mark keeps its width", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Pocket"));

    /* By their titles: an empty board says "Settings" in its hint as well, and
       this is about the two links in the bar. */
    await expect(page.getByTitle("The tasks that are archived")).toBeVisible();
    await expect(page.getByTitle("Project settings")).toBeVisible();
    expect(await overflow(page)).toBe(0);

    const mark = await page.getByTestId("board-mark").boundingBox();
    expect(mark!.width).toBe(18);
    expect(mark!.height).toBe(18);
  });
});

/*
 * A phone cannot draw two 272 px columns side by side, so from 560 px down it
 * draws one and names the rest in a strip above it. Three ways reach another
 * column — a pill, a swipe and the arrows — and they all write one word, which
 * is why the strip, the canvas and the cursor can never disagree.
 */
test.describe("A board on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("draws one column, and the strip is the way to the others", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Pocket"));
    await aColumnEach(page);

    // A phone opens on the first column, every time.
    await page.goto(`/p/${projectId}`);
    await expect(page.getByTestId("column")).toHaveCount(1);
    await expect(column(page, "Backlog")).toBeVisible();
    await expect(card(page, "Aardvark")).toBeVisible();
    await expect(card(page, "Beetle")).toHaveCount(0);

    // Full width, and nowhere to push the board sideways.
    const drawn = await page.getByTestId("column").boundingBox();
    expect(drawn!.width).toBeGreaterThan(340);
    expect(await overflow(page)).toBe(0);
    expect(await sideways(page)).toBe(0);

    // The strip names every column of the view and says what is in each.
    const pills = page.getByTestId("column-pill");
    await expect(pills).toHaveCount(5);
    expect(await names(pills)).toEqual(["BACKLOG", "TODO", "IN PROGRESS", "READY", "SHIPPED"]);
    await expect(pills.getByTestId("column-pill-count")).toHaveText(["1", "1", "1", "0", "0"]);
    await forAFinger(pills, 5);

    // A pill is one way to another column.
    await columnPill(page, "Todo").click();
    await expect(column(page, "Todo")).toBeVisible();
    await expect(page.getByTestId("column")).toHaveCount(1);
    await expect(card(page, "Beetle")).toBeVisible();
    await expect(card(page, "Aardvark")).toHaveCount(0);
    expect(await sideways(page)).toBe(0);

    // The arrows are another, through the cursor the board already has: the
    // card the cursor lands on is in the next column, so the board pages and
    // the focus follows it there.
    await card(page, "Beetle").first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(column(page, "In Progress")).toBeVisible();
    await expect(card(page, "Cricket").first()).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(column(page, "Todo")).toBeVisible();
    await expect(card(page, "Beetle").first()).toBeFocused();

    // And `n` makes a task at the top of the column on screen.
    await page.keyboard.press("n");
    const composer = page.getByPlaceholder("What needs doing?");
    await composer.fill("Dingo");
    await composer.press("Enter");
    await expect(card(page, "Dingo")).toBeVisible();
    await page.getByRole("button", { name: "Close task" }).click();
    await expect(column(page, "Todo").getByTestId("card")).toHaveCount(2);
    expect(await counts(pills)).toEqual(["1", "2", "1", "0", "0"]);
  });

  test("a card moves by the panel, and the strip says where it went", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Pocket"));
    await aColumnEach(page);

    await columnPill(page, "Todo").click();

    /* Nothing down here drags. A column has no grip and no fold, and a card
       cannot be lifted — which is what leaves a sideways finger to the board. */
    await expect(page.getByRole("button", { name: /^Reorder the column / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Fold the column / })).toHaveCount(0);
    await card(page, "Beetle").first().focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("card-overlay")).toHaveCount(0);

    /* So the panel's own control is how a card changes column: it writes the
       one value a drop across a board writes. */
    await card(page, "Beetle").click();
    const panel = page.getByTestId("task-panel");
    await panel.getByRole("button", { name: /^Todo/ }).click();
    await saved(page, () => panel.getByRole("button", { name: /^Ready/ }).click());
    await page.getByRole("button", { name: "Close task" }).click();

    const pills = page.getByTestId("column-pill");
    expect(await counts(pills)).toEqual(["1", "0", "1", "1", "0"]);
    await expect(card(page, "Beetle")).toHaveCount(0);

    await columnPill(page, "Ready").click();
    await expect(card(page, "Beetle")).toBeVisible();
    expect(await sideways(page)).toBe(0);
  });

  test("picks a card and archives it, with no hover to find the check", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Pocket"));
    await aColumnEach(page);

    await columnPill(page, "Todo").click();
    await card(page, "Beetle").getByTestId("card-pick").click();
    await expect(page.getByTestId("pick-bar")).toBeVisible();
    await expect(page.getByTestId("pick-count")).toHaveText("1 selected");
    expect(await overflow(page)).toBe(0);

    await page.getByTestId("pick-archive").click();
    await expect(page.getByTestId("pick-confirm")).toHaveText("Archive 1 task?");
    await settles(page, /\/api\/projects\/[0-9a-f-]+\/archive$/, () =>
      page.getByTestId("pick-archive-yes").click(),
    );
    await expect(card(page, "Beetle")).toHaveCount(0);
    expect(await counts(page.getByTestId("column-pill"))).toEqual(["1", "0", "1", "0", "0"]);
  });

  test("the strip scrolls to the column you are on, and fades where there is more", async ({
    page,
  }) => {
    await register(page);
    await createProject(page, unique("Pocket"));
    await aColumnEach(page);

    /* Five pills are wider than a phone, so the row pans — and the scrollbar
       is hidden, so the fade at the end is the only thing that says so. */
    const pills = page.getByTestId("column-pills");
    expect(await hidden(pills)).toBeGreaterThan(0);
    expect(await maskOf(pills)).toContain("linear-gradient");

    /* The filled pill is the whole point of the strip, so paging to the last
       column has to bring its pill with it. It used to sit two hundred pixels
       past the end of a strip that had not moved. */
    await columnPill(page, "Shipped").click();
    await expect(column(page, "Shipped")).toBeVisible();
    await inside(columnPill(page, "Shipped"), pills);

    /* The fade is now at the other end, because that is where the rest is. */
    expect(await pills.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    expect(await maskOf(pills)).toContain("linear-gradient");

    /* And back the other way: the strip goes to the start with it. */
    await columnPill(page, "Backlog").click();
    await expect(column(page, "Backlog")).toBeVisible();
    await inside(columnPill(page, "Backlog"), pills);
    expect(await pills.evaluate((el) => el.scrollLeft)).toBe(0);
  });
});

/*
 * The same board under a finger. A phone has no hover, so the check that picks
 * a card cannot wait for one, and a sideways swipe is how a page turns.
 */
test.describe("A board under a finger", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });

  test("shows the check without a hover, and pages on a swipe", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Pocket"));
    await aColumnEach(page);

    await columnPill(page, "Todo").click();
    const check = card(page, "Beetle").getByTestId("card-pick");
    expect(await check.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    /* And it is the only way in down here, so a finger has to be able to hit
       it: a miss lands on the card and opens the task. The check itself is
       still 15 px, because the button grew around it and not with it. */
    await forAFinger(check, 1);
    const box = await check.getByTestId("card-pick-box").boundingBox();
    expect(Math.round(box!.width)).toBe(15);

    // A finger going left brings the next column in; going right, the one
    // before. A short one says nothing at all.
    await swipe(page, -160, 0);
    await expect(column(page, "In Progress")).toBeVisible();
    await swipe(page, 160, 0);
    await expect(column(page, "Todo")).toBeVisible();
    await swipe(page, -40, 0);
    await expect(column(page, "Todo")).toBeVisible();

    // And a finger going down is the column scrolling, whatever it does
    // sideways on the way.
    await swipe(page, -90, 300);
    await expect(column(page, "Todo")).toBeVisible();
  });
});

/** One card in each of the first three columns, and two columns left empty. */
async function aColumnEach(page: Page) {
  for (const [columnName, title] of [
    ["Backlog", "Aardvark"],
    ["Todo", "Beetle"],
    ["In Progress", "Cricket"],
  ] as const) {
    await addTask(page, columnName, title);
    await page.getByRole("button", { name: "Close task" }).click();
  }
}

/** How much of a scrolling row is past its own edges. */
async function hidden(row: Locator): Promise<number> {
  return row.evaluate((el) => el.scrollWidth - el.clientWidth);
}

/** What the row is faded with. A row with nothing past its edges has none. */
async function maskOf(row: Locator): Promise<string> {
  return row.evaluate((el) => getComputedStyle(el).maskImage);
}

/** One pill is drawn inside the strip that holds it, from end to end. */
async function inside(pill: Locator, row: Locator) {
  const one = await pill.boundingBox();
  const box = await row.boundingBox();
  expect(one!.x, "the pill starts before the strip").toBeGreaterThanOrEqual(box!.x - 1);
  expect(one!.x + one!.width, "the pill ends past the strip").toBeLessThanOrEqual(
    box!.x + box!.width + 1,
  );
}

/** How far the board can be pushed sideways. A phone has nowhere to push it. */
async function sideways(page: Page): Promise<number> {
  return page.getByTestId("board-canvas").evaluate((el) => el.scrollWidth - el.clientWidth);
}

/** The names in the column strip, left to right. The pills are uppercase. */
async function names(pills: Locator): Promise<string[]> {
  return (await pills.getByTestId("column-pill-name").allInnerTexts()).map((t) =>
    t.trim().toUpperCase(),
  );
}

/** What each pill says is in its column, left to right. */
async function counts(pills: Locator): Promise<string[]> {
  return pills.getByTestId("column-pill-count").allInnerTexts();
}

/**
 * One finger, across the middle of the board.
 *
 * Playwright's touchscreen only taps, so the three events go through the
 * browser itself. They are real touches, which is the point: the board reads a
 * swipe the way it reads a finger, and nothing here simulates its answer.
 */
async function swipe(page: Page, dx: number, dy: number) {
  const box = await page.getByTestId("board-canvas").boundingBox();
  const from = { x: box!.x + box!.width / 2, y: box!.y + 60 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let i = 1; i <= 4; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + (dx * i) / 4, y: from.y + (dy * i) / 4 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/*
 * A small tablet, and a window as narrow as one. Both names used to go at
 * 560 px, where the bar still had 118 px of room. They go at 520 px now, and
 * the box that finds a task is what gives its width up first.
 */
test.describe("The top bar on a small tablet", () => {
  test.use({ viewport: { width: 560, height: 820 } });

  test("keeps the project name and the person's name", async ({ page }) => {
    const account = await register(page);
    /* A short name on purpose: this measures the room the bar has, not how
       long a name may be. */
    await createProject(page, "Pocket");

    const crumb = page.getByTestId("board-crumb");
    const person = page.getByTestId("user-name");
    await expect(crumb).toBeVisible();
    await expect(person).toBeVisible();
    await expect(crumb).toHaveText("Pocket");
    await expect(person).toHaveText(account.name);
    await whole(crumb);
    await whole(person);
    expect(await overflow(page)).toBe(0);

    /* And gives them up on a phone, where there is no room for them. */
    await page.setViewportSize({ width: 390, height: 820 });
    await expect(page.getByTestId("board-crumb")).toBeHidden();
    await expect(page.getByTestId("user-name")).toBeHidden();
    expect(await overflow(page)).toBe(0);
  });
});

/*
 * A small tablet with a long name at each end of the bar and three cards
 * picked. The bar ran 80 px off its own side here, and the box that finds a
 * task was squeezed to 31 px of border and padding on the way — neither with
 * a sound, because the shell clips what hangs out of it rather than scrolling.
 */
test.describe("The top bar with cards picked", () => {
  test.use({ viewport: { width: 600, height: 820 } });

  test("keeps every part inside the bar, and the box keeps its floor", async ({ page }) => {
    await register(page, "Wilhelmina Featherstonehaugh");
    await createProject(page, unique("Pocket"));
    for (const title of ["Aardvark", "Beetle", "Cricket"]) {
      await addTask(page, "Todo", title);
      await page.getByRole("button", { name: "Close task" }).click();
    }

    /* Nothing is picked yet. The names shorten, and the box is never a sliver:
       a box this narrow is a border and its padding and nothing else. */
    await expect(page.getByTestId("search-box")).toBeVisible();
    expect(await searchWidth(page)).toBeGreaterThanOrEqual(88);
    expect(await pastTheBar(page)).toBe(0);

    for (const title of ["Aardvark", "Beetle", "Cricket"]) {
      await card(page, title).getByTestId("card-pick").click();
    }
    await expect(page.getByTestId("pick-bar")).toBeVisible();

    /* What gave the room: the ways off this board. What kept its place: the
       picture and the name of the person, and the mark that names the
       project. */
    await expect(page.getByTestId("search-box")).toBeHidden();
    await expect(page.getByTitle("Project settings")).toBeHidden();
    await expect(page.getByTestId("board-mark")).toBeVisible();
    await expect(page.getByTestId("user-name")).toBeVisible();
    expect(await pastTheBar(page)).toBe(0);

    /* The question is longer than the count, so it is measured as well. */
    await page.getByTestId("pick-archive").click();
    await expect(page.getByTestId("pick-confirm")).toHaveText("Archive 3 tasks?");
    expect(await pastTheBar(page)).toBe(0);
    await page.getByTestId("pick-archive-no").click();

    /* And it is a loan, not a taking. */
    await page.getByTestId("pick-clear").click();
    await expect(page.getByTestId("pick-bar")).toHaveCount(0);
    await expect(page.getByTestId("search-box")).toBeVisible();
    expect(await searchWidth(page)).toBeGreaterThanOrEqual(88);

    /* The floor holds on both sides of the width the names shorten at. It
       used to end there, so the box lost 23 px on one pixel of window. */
    for (const width of [560, 561]) {
      await page.setViewportSize({ width, height: 820 });
      await expect(page.getByTestId("search-box")).toBeVisible();
      expect(await searchWidth(page), `the box at ${width} px`).toBeGreaterThanOrEqual(88);
      expect(await pastTheBar(page)).toBe(0);
    }
  });
});

/** How wide the box that finds a task is drawn. */
async function searchWidth(page: Page): Promise<number> {
  const box = await page.getByTestId("search-box").boundingBox();
  return Math.round(box!.width);
}

/**
 * The whole of the name is drawn.
 *
 * A box narrower than its text draws an ellipsis and keeps the text, so
 * anything that reads the words passes on a name cut to one letter. The two
 * widths are the only things that say so.
 */
async function whole(name: Locator) {
  const box = await name.evaluate((el) => ({ text: el.scrollWidth, drawn: el.clientWidth }));
  expect(box.text, `"${await name.textContent()}" is cut off`).toBeLessThanOrEqual(box.drawn);
}
