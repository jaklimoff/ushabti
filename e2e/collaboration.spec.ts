import { expect, test, type Browser } from "@playwright/test";
import {
  addFilter,
  addTask,
  card,
  column,
  columnOrder,
  createProject,
  dragCard,
  gotoSettings,
  putFilterOnView,
  register,
  saved,
  signIn,
  settles,
  sortBoard,
  unique,
  type Account,
} from "./helpers";

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test.describe("Two people on one board", () => {
  test("the owner adds a friend, who then sees the board", async ({ browser }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("Shared"));
    await addTask(owner.page, "Todo", "Shared work");
    await owner.page.getByRole("button", { name: "Close task" }).click();

    const friendAccount: Account = await register(friend.page, "Friend Person");

    // the friend cannot reach the project yet
    await friend.page.goto(`/p/${projectId}`);
    await expect(friend.page.getByText("This page is not here")).toBeVisible();

    await gotoSettings(owner.page, projectId, "people");
    await owner.page.getByLabel("Email of the new member").fill(friendAccount.email);
    await owner.page.getByRole("button", { name: "Add member" }).click();
    await expect(owner.page.getByText(friendAccount.email)).toBeVisible();

    await friend.page.goto(`/p/${projectId}`);
    await expect(card(friend.page, "Shared work")).toBeVisible();

    await owner.context.close();
    await friend.context.close();
  });

  test("a change by one person reaches the other without a reload", async ({ browser }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("Live"));
    const friendAccount = await register(friend.page, "Friend Person");

    await gotoSettings(owner.page, projectId, "people");
    await owner.page.getByLabel("Email of the new member").fill(friendAccount.email);
    await owner.page.getByRole("button", { name: "Add member" }).click();
    await expect(owner.page.getByText(friendAccount.email)).toBeVisible();

    await friend.page.goto(`/p/${projectId}`);
    await expect(friend.page.getByTestId("live-dot")).toBeVisible();

    await owner.page.goto(`/p/${projectId}`);
    await addTask(owner.page, "Todo", "Arrives by itself");

    // no reload on the friend's side
    await expect(card(friend.page, "Arrives by itself")).toBeVisible({ timeout: 15_000 });

    // and a move travels too
    await owner.page.getByRole("button", { name: "Close task" }).click();
    await dragCard(owner.page, "Arrives by itself", {
      x: (await column(owner.page, "Ready").boundingBox())!.x + 130,
      y: 200,
    });
    await expect(column(friend.page, "Ready").getByText("Arrives by itself")).toBeVisible({
      timeout: 15_000,
    });

    await owner.context.close();
    await friend.context.close();
  });

  test("a remote change does not throw away a comment being written", async ({ browser }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("Draft"));
    const friendAccount = await register(friend.page, "Friend Person");

    await gotoSettings(owner.page, projectId, "people");
    await owner.page.getByLabel("Email of the new member").fill(friendAccount.email);
    await owner.page.getByRole("button", { name: "Add member" }).click();
    await expect(owner.page.getByText(friendAccount.email)).toBeVisible();

    await owner.page.goto(`/p/${projectId}`);
    await addTask(owner.page, "Todo", "Something to discuss");

    // The panel is open on the new task. Start a note, but do not send it.
    const composer = owner.page.getByPlaceholder("Leave a note…");
    await composer.fill("Half a thought");

    // The friend changes the board, which re-renders the owner's side.
    await friend.page.goto(`/p/${projectId}`);
    await expect(friend.page.getByTestId("live-dot")).toBeVisible();
    await addTask(friend.page, "Todo", "Arrives by itself");
    await expect(card(owner.page, "Arrives by itself")).toBeVisible({ timeout: 15_000 });

    // The note survived the re-render, and it can still be sent.
    await expect(composer).toHaveValue("Half a thought");
    await owner.page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(owner.page.getByText("Half a thought")).toBeVisible();

    await owner.context.close();
    await friend.context.close();
  });

  /*
   * The board is shared, so an open panel has to follow what the other person
   * does to its task. It used to keep "Archive task" in its menu and draw no
   * archived row until the page was loaded again.
   */
  test("a task the other person archives reaches an open panel", async ({ browser }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("Follows"));
    const friendAccount = await register(friend.page, "Friend Person");

    await gotoSettings(owner.page, projectId, "people");
    await owner.page.getByLabel("Email of the new member").fill(friendAccount.email);
    await owner.page.getByRole("button", { name: "Add member" }).click();
    await expect(owner.page.getByText(friendAccount.email)).toBeVisible();

    await owner.page.goto(`/p/${projectId}`);
    await addTask(owner.page, "Todo", "Watched from both sides");
    // The owner leaves the panel open on it and touches nothing else.
    await expect(owner.page.getByTestId("task-panel")).toBeVisible();
    await expect(owner.page.getByTestId("archived-row")).toHaveCount(0);

    await friend.page.goto(`/p/${projectId}`);
    await expect(friend.page.getByTestId("live-dot")).toBeVisible();
    await card(friend.page, "Watched from both sides").click();
    await friend.page.getByRole("button", { name: "Task menu" }).click();
    await friend.page.getByTestId("archive-task").click();
    await expect(friend.page.getByTestId("archived-row")).toBeVisible();

    // The owner's panel says so by itself, and stops offering the archive.
    await expect(owner.page.getByTestId("archived-row")).toBeVisible({ timeout: 15_000 });
    await expect(card(owner.page, "Watched from both sides")).toHaveCount(0);
    await owner.page.getByRole("button", { name: "Task menu" }).click();
    await expect(owner.page.getByTestId("archive-task")).toHaveCount(0);
    // Escape closes the menu. The panel keeps its place.
    await owner.page.keyboard.press("Escape");
    await expect(owner.page.getByTestId("task-panel")).toBeVisible();

    // And the way back travels the same distance.
    await friend.page.getByRole("button", { name: "Put it back" }).click();
    await expect(friend.page.getByTestId("archived-row")).toHaveCount(0);

    await expect(owner.page.getByTestId("archived-row")).toHaveCount(0, { timeout: 15_000 });
    await expect(card(owner.page, "Watched from both sides").first()).toBeVisible();
    await owner.page.getByRole("button", { name: "Task menu" }).click();
    await expect(owner.page.getByTestId("archive-task")).toBeVisible();

    await owner.context.close();
    await friend.context.close();
  });

  test("a person property lists the members and sticks", async ({ browser }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("People"));
    const friendAccount = await register(friend.page, "Friend Person");

    await gotoSettings(owner.page, projectId, "people");
    await owner.page.getByLabel("Email of the new member").fill(friendAccount.email);
    await owner.page.getByRole("button", { name: "Add member" }).click();
    await expect(owner.page.getByText(friendAccount.email)).toBeVisible();

    await owner.page.goto(`/p/${projectId}`);
    await addTask(owner.page, "Todo", "Give it to a friend");

    const panel = owner.page.getByTestId("task-panel");
    await panel.getByRole("button", { name: "Unassigned" }).click();
    await saved(owner.page, () => panel.getByRole("option", { name: "Friend Person" }).click());

    await owner.page.goto(`/p/${projectId}`);
    await card(owner.page, "Give it to a friend").click();
    await expect(panel.getByRole("button", { name: "Friend Person" })).toBeVisible();

    await owner.context.close();
    await friend.context.close();
  });

  /*
   * The fault this feature exists to fix: a member who filtered to their own
   * name used to re-filter the board for the whole team. So the rule stays on
   * one screen until somebody says otherwise, in as many words.
   */
  test("a filter one person adds reaches the other only when they say so", async ({ browser }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    const ownerAccount = await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("Lens"));
    const friendAccount = await register(friend.page, "Friend Person");

    await gotoSettings(owner.page, projectId, "people");
    await owner.page.getByLabel("Email of the new member").fill(friendAccount.email);
    await owner.page.getByRole("button", { name: "Add member" }).click();
    await expect(owner.page.getByText(friendAccount.email)).toBeVisible();

    await owner.page.goto(`/p/${projectId}`);
    await addTask(owner.page, "Todo", "Urgent work");
    await owner.page.getByRole("button", { name: "Urgent", exact: true }).click();
    await owner.page.getByRole("button", { name: "Close task" }).click();
    await addTask(owner.page, "Todo", "Ordinary work");
    await owner.page.getByRole("button", { name: "Close task" }).click();

    await friend.page.goto(`/p/${projectId}`);
    await expect(friend.page.getByTestId("live-dot")).toBeVisible();
    await expect(card(friend.page, "Ordinary work")).toBeVisible();

    await addFilter(owner.page, "Priority", "Urgent");
    await expect(card(owner.page, "Ordinary work")).toHaveCount(0);

    /* The friend's board must not move. A shared write arrives in well under
       this, so a board that was going to narrow would have narrowed by now. */
    await friend.page.waitForTimeout(2500);
    await expect(card(friend.page, "Ordinary work")).toBeVisible();
    await expect(friend.page.getByTestId("filter-row")).toHaveCount(0);

    /* The rule is saved against the person and not held in the tab, so the
       same person on another machine finds it waiting for them. */
    const elsewhere = await freshPage(browser);
    await signIn(elsewhere.page, ownerAccount);
    await elsewhere.page.goto(`/p/${projectId}`);
    await expect(elsewhere.page.getByTestId("filter-chip")).toHaveText("Priority is Urgent");
    await expect(card(elsewhere.page, "Ordinary work")).toHaveCount(0);
    await elsewhere.context.close();

    // One press, and it is the team's question.
    await putFilterOnView(owner.page);

    await expect(card(friend.page, "Ordinary work")).toHaveCount(0, { timeout: 15_000 });
    await expect(friend.page.getByTestId("filter-chip")).toHaveText("Priority is Urgent");
    // It is the view's on their side too, so nothing there says "only you".
    await expect(friend.page.getByTestId("filter-mine")).toHaveCount(0);

    await owner.context.close();
    await friend.context.close();
  });
});

/*
 * A sorted board holds still, so an order one person picked used to stop the
 * whole team dragging inside a column, with nothing on their screen to say
 * why. The order is theirs now, exactly as a filter is.
 */
test.describe("An order one person picks", () => {
  test("holds only their board still, until they save it for everyone", async ({ browser }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("SortLens"));
    const friendAccount = await register(friend.page, "Friend Person");

    await gotoSettings(owner.page, projectId, "people");
    await owner.page.getByLabel("Email of the new member").fill(friendAccount.email);
    await owner.page.getByRole("button", { name: "Add member" }).click();
    await expect(owner.page.getByText(friendAccount.email)).toBeVisible();

    await owner.page.goto(`/p/${projectId}`);
    await addTask(owner.page, "Todo", "Ordinary work");
    await owner.page.getByRole("button", { name: "Close task" }).click();
    await addTask(owner.page, "Todo", "Urgent work");
    await owner.page.getByRole("button", { name: "Urgent", exact: true }).click();
    await owner.page.getByRole("button", { name: "Close task" }).click();

    await friend.page.goto(`/p/${projectId}`);
    await expect(friend.page.getByTestId("live-dot")).toBeVisible();
    await expect(card(friend.page, "Urgent work")).toBeVisible();

    // Mine, and the strip says so.
    await sortBoard(owner.page, "Priority");
    await expect(owner.page.getByTestId("sort-chip")).toContainText("Priority");
    await expect(owner.page.getByTestId("sort-chip")).not.toHaveAttribute("data-shared", "true");
    await expect(owner.page.getByTestId("filter-mine")).toBeVisible();
    expect(await columnOrder(owner.page, "Todo")).toEqual(["Urgent work", "Ordinary work"]);

    /* The friend's board must not move, and it must still drag. A shared
       write arrives in well under this. */
    await friend.page.waitForTimeout(2500);
    await expect(friend.page.getByTestId("sort-chip")).toHaveCount(0);
    expect(await columnOrder(friend.page, "Todo")).toEqual(["Ordinary work", "Urgent work"]);

    const ordinary = (await card(friend.page, "Ordinary work").boundingBox())!;
    await dragCard(friend.page, "Urgent work", {
      x: ordinary.x + ordinary.width / 2,
      y: ordinary.y + 10,
    });
    expect(await columnOrder(friend.page, "Todo")).toEqual(["Urgent work", "Ordinary work"]);

    // One press, and the order goes to the view with the rules.
    await putFilterOnView(owner.page);
    await expect(owner.page.getByTestId("filter-mine")).toHaveCount(0);
    await expect(owner.page.getByTestId("sort-chip")).toHaveAttribute("data-shared", "true");
    await expect(friend.page.getByTestId("sort-chip")).toContainText("Priority", {
      timeout: 15_000,
    });
    await expect(friend.page.getByTestId("sort-chip")).toHaveAttribute("data-shared", "true");

    const board = await (await owner.page.request.get(`/api/projects/${projectId}/board`)).json();
    const view = board.views.find((v: { isDefault: boolean }) => v.isDefault);
    expect(view.sort).toEqual({ columnId: expect.any(String), direction: "asc" });
    expect(view.lensSort).toBeNull();

    await owner.context.close();
    await friend.context.close();
  });
});

test.describe("Columns", () => {
  test("dragging a column header changes the order for good", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("ColumnOrder"));

    // The header is uppercased in CSS, so innerText depends on whether the
    // stylesheet has landed. The order is what this test is about.
    const names = async () =>
      (await page.getByTestId("column-name").allInnerTexts()).map((t) => t.trim().toUpperCase());

    expect(await names()).toEqual(["BACKLOG", "TODO", "IN PROGRESS", "READY", "SHIPPED"]);

    const grip = page.getByRole("button", { name: "Reorder the column Backlog" });
    const from = (await grip.boundingBox())!;
    const target = (await column(page, "In Progress").boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 20; i += 1) {
      await page.mouse.move(from.x + ((target.x + 60 - from.x) * i) / 20, from.y + from.height / 2);
      if (i % 5 === 0) await page.waitForTimeout(30);
    }
    await page.waitForTimeout(160);
    await settles(page, /^\/api\/options\/[0-9a-f-]+$/, () => page.mouse.up());
    await page.waitForTimeout(400);

    const after = await names();
    expect(after[0]).not.toBe("BACKLOG");
    expect(after).toContain("BACKLOG");

    await page.goto(`/p/${projectId}`);
    expect(await names()).toEqual(after);
  });
});

test.describe("A shared view that says Me", () => {
  /*
   * One shared "My tasks" view. The rule says Me and never a name, so the
   * same rule shows each person their own cards, and a card added under it
   * goes to whoever added it.
   */
  test("a shared view with Assignee is Me shows each viewer their own", async ({ browser }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("Mine"));
    const friendAccount = await register(friend.page, "Friend Person");

    await gotoSettings(owner.page, projectId, "people");
    await owner.page.getByLabel("Email of the new member").fill(friendAccount.email);
    await owner.page.getByRole("button", { name: "Add member" }).click();
    await expect(owner.page.getByText(friendAccount.email)).toBeVisible();

    await owner.page.goto(`/p/${projectId}`);
    const panel = owner.page.getByTestId("task-panel");
    for (const [title, who] of [
      ["Owner work", "Owner Person"],
      ["Friend work", "Friend Person"],
    ]) {
      await addTask(owner.page, "Todo", title);
      await panel.getByRole("button", { name: "Unassigned" }).click();
      await saved(owner.page, () => panel.getByRole("option", { name: who }).click());
      await owner.page.getByRole("button", { name: "Close task" }).click();
    }

    await addFilter(owner.page, "Assignee", "Me");
    await expect(owner.page.getByTestId("filter-chip")).toHaveText("Assignee is Me");
    await putFilterOnView(owner.page);
    await expect(card(owner.page, "Owner work")).toBeVisible();
    await expect(card(owner.page, "Friend work")).toHaveCount(0);

    // The same saved rule, read by the other person.
    await friend.page.goto(`/p/${projectId}`);
    await expect(friend.page.getByTestId("filter-chip")).toHaveText("Assignee is Me");
    await expect(card(friend.page, "Friend work")).toBeVisible();
    await expect(card(friend.page, "Owner work")).toHaveCount(0);

    await friend.page
      .getByRole("button", { name: "Add a task to the top of Todo" })
      .first()
      .click();
    await expect(friend.page.getByText("sets Assignee Friend Person")).toBeVisible();
    const box = friend.page.getByPlaceholder("What needs doing?");
    await box.fill("Friend adds more");
    await box.press("Enter");
    await friend.page.getByRole("button", { name: "Close task" }).click();
    await expect(card(friend.page, "Friend adds more")).toBeVisible();
    await expect(card(owner.page, "Friend adds more")).toHaveCount(0);

    await owner.context.close();
    await friend.context.close();
  });
});
