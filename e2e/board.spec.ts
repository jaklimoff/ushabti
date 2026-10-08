import { expect, test } from "@playwright/test";
import {
  addTask,
  card,
  centreOf,
  column,
  columnOrder,
  columnPill,
  createProject,
  dragCard,
  forAFinger,
  register,
  settles,
  sortBoard,
  unique,
  descriptionBox,
  fillBox,
} from "./helpers";

type Page = import("@playwright/test").Page;

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
  test(
    "sign up, create a project and get the default properties",
    { tag: "@smoke" },
    async ({ page }) => {
      await register(page, "Ada Lovelace");
      await createProject(page, unique("Roadmap"));

      for (const name of ["BACKLOG", "TODO", "IN PROGRESS", "READY", "SHIPPED"]) {
        await expect(column(page, name)).toBeVisible();
      }
      await expect(page.getByRole("button", { name: /^Board/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Phases/ })).toBeVisible();
    },
  );

  test("add a task, open it and edit every part", { tag: "@smoke" }, async ({ page }) => {
    await register(page);
    await createProject(page, unique("Editing"));

    await addTask(page, "Todo", "Write the first task");
    // The panel opens by itself after the task is created.
    await expect(page.getByRole("tab", { name: /^Comments/ })).toBeVisible();

    // title
    const title = page.getByTestId("task-title");
    await title.click();
    await title.fill("Write the first task, renamed");
    await title.press("Enter");
    await expect(card(page, "Write the first task, renamed").first()).toBeVisible();

    // description with markdown
    await page.getByText("Add a description…").click();
    const editor = descriptionBox(page);
    await fillBox(editor, "Ships **offline** first.\n\n- one\n- two");
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
    await expect(page.getByRole("tab", { name: /^Comments 1/ })).toBeVisible();

    // a comment reads like a description: it is markdown too
    const posted = page.getByTestId("comment-markdown");
    await expect(posted.locator("strong")).toHaveText("right");
    await expect(posted.locator("li")).toHaveCount(2);

    // activity
    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect(page.getByText(/created the task/)).toBeVisible();
  });

  test(
    "set a property from the panel and see it on the card",
    { tag: "@smoke" },
    async ({ page }) => {
      await register(page);
      await createProject(page, unique("Props"));
      await addTask(page, "Todo", "Priority test");

      await page.getByRole("button", { name: "Urgent" }).click();
      await page.getByRole("button", { name: "Close task" }).click();

      const square = card(page, "Priority test").getByTestId("card-chip").first();
      await expect(square).toHaveAttribute("title", "Priority · Urgent");
    },
  );

  test(
    "drag a card into another column and it stays there",
    { tag: "@smoke" },
    async ({ page }) => {
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
    },
  );

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

  test("drag reorders cards inside one column", { tag: "@smoke" }, async ({ page }) => {
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

  test(
    "checklist and comment counts reach the card and survive a reload",
    { tag: "@smoke" },
    async ({ page }) => {
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
    },
  );

  test("a card moves with the keyboard alone", { tag: "@smoke" }, async ({ page }) => {
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

  test("the arrow keys move the cursor from card to card", { tag: "@smoke" }, async ({ page }) => {
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

    // The whole board is one tab stop, not one for every card. Closing a
    // task left the cursor on the card that was open.
    const tabStop = page.locator('[data-testid="card"][tabindex="0"]');
    await expect(tabStop).toHaveCount(1);
    await expect(tabStop).toContainText("Two columns over");

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

  test("create a view grouped by another property", { tag: "@smoke" }, async ({ page }) => {
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

  /* The rest of the fold — the strip, the width it gives back, the next page
     keeping it and a phone ignoring it — is drawn in `Board.test.tsx`. A drop
     onto the strip is a drag across columns, so this part stays here. */
  test("a column folds to a strip, takes a card, and opens again", async ({ page }) => {
    await register(page);
    await createProject(page, unique("Folding"));

    await addTask(page, "Todo", "Fold me across");
    await page.getByRole("button", { name: "Close task" }).click();

    const shipped = column(page, "Shipped");
    const open = page.getByRole("button", { name: "Open the column Shipped" });

    await page.getByRole("button", { name: "Fold the column Shipped" }).click();
    await expect(open).toBeVisible();

    // A folded column is still a drop target, so nothing is lost on a strip.
    await dragCard(page, "Fold me across", await centreOf(page, "Shipped"));
    await expect(shipped.getByTestId("column-count")).toHaveText("1");
    await expect(column(page, "Todo").getByTestId("card")).toHaveCount(0);

    await open.click();
    await expect(shipped.getByText("Fold me across")).toBeVisible();
  });
});

/* A board is ordered from a button, because it has no heading to press. What
   the order then means is the list's answer, read by the same file. */
test.describe("Ordering a board", () => {
  test(
    "orders every column, and the cards hold still while it is on",
    { tag: "@smoke" },
    async ({ page }) => {
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
      await dragCard(
        page,
        "Aardvark",
        { x: beetle!.x + beetle!.width / 2, y: beetle!.y + 10 },
        null,
      );
      expect(await columnOrder(page, "Todo")).toEqual(["Beetle", "Aardvark", "Cricket"]);
      // The drop animates the overlay home; a lift before it lands draws two.
      await expect(page.getByTestId("card-overlay")).toHaveCount(0);

      // Nor do the arrows of a lifted card: they belong to the drag, and inside
      // a sorted column there is nowhere for them to take it. The drag's own
      // overlay fades out first, which takes longer on a busy machine.
      await expect(page.getByTestId("card-overlay")).toHaveCount(0);
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
      await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
        page.getByTestId("sort-clear").click(),
      );
      await expect(page.getByTestId("sort-chip")).toHaveCount(0);
      expect(await columnOrder(page, "Backlog")).toEqual(["Aardvark", "Dingo"]);
      expect(await columnOrder(page, "Todo")).toEqual(["Beetle", "Cricket"]);
    },
  );

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
});

/*
 * The same board under a finger. A phone has no hover, so the check that picks
 * a card cannot wait for one, and a sideways swipe is how a page turns. The
 * rest of a phone board is drawn in `Board.test.tsx`; this needs a touch
 * screen, which only a browser context of its own has.
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
