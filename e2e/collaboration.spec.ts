import { expect, test, type Browser } from "@playwright/test";
import {
  addTask,
  card,
  column,
  createProject,
  dragCard,
  register,
  saved,
  settles,
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

    await owner.page.goto(`/p/${projectId}/settings`);
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

    await owner.page.goto(`/p/${projectId}/settings`);
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

    await owner.page.goto(`/p/${projectId}/settings`);
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

  test("a person property lists the members and sticks", async ({ browser }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("People"));
    const friendAccount = await register(friend.page, "Friend Person");

    await owner.page.goto(`/p/${projectId}/settings`);
    await owner.page.getByLabel("Email of the new member").fill(friendAccount.email);
    await owner.page.getByRole("button", { name: "Add member" }).click();
    await expect(owner.page.getByText(friendAccount.email)).toBeVisible();

    await owner.page.goto(`/p/${projectId}`);
    await addTask(owner.page, "Todo", "Give it to a friend");

    const panel = owner.page.getByTestId("task-panel");
    await panel.getByRole("button", { name: "Unassigned" }).click();
    await saved(owner.page, () => panel.getByRole("button", { name: "Friend Person" }).click());

    await owner.page.goto(`/p/${projectId}`);
    await card(owner.page, "Give it to a friend").click();
    await expect(panel.getByRole("button", { name: "Friend Person" })).toBeVisible();

    await owner.context.close();
    await friend.context.close();
  });
});

test.describe("Columns", () => {
  test("dragging a column header changes the order for good", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("ColumnOrder"));

    const names = async () =>
      (await page.getByTestId("column-name").allInnerTexts()).map((t) => t.trim());

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
