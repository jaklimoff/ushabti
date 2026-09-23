import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { addTask, card, createProject, gotoSettings, register, unique } from "./helpers";

/*
 * Who else has a task open. Nothing stores it: a tab says where it is, the
 * stream relays it, and every other tab keeps its own room on a lease.
 */

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

async function addMember(owner: Page, projectId: string, email: string) {
  await gotoSettings(owner, projectId, "people");
  await owner.getByLabel("Email of the new member").fill(email);
  await owner.getByRole("button", { name: "Add member" }).click();
  await expect(owner.getByText(email)).toBeVisible();
}

async function taskIdOf(page: Page, projectId: string, title: string): Promise<string> {
  const res = await page.request.get(`/api/projects/${projectId}/board`);
  const board = (await res.json()) as { tasks: { id: string; title: string }[] };
  const task = board.tasks.find((t) => t.title === title);
  if (!task) throw new Error(`No task called ${title}.`);
  return task.id;
}

/** A presence said by a tab that is not a page: it never says it again. */
function sayFrom(context: BrowserContext, projectId: string, taskId: string | null) {
  return context.request.post(`/api/projects/${projectId}/presence`, {
    headers: { "x-ushabti-client": randomUUID() },
    data: { taskId, field: null },
  });
}

const faces = (page: Page) => page.getByTestId("panel-present-face");

test.describe("Who else has the task open", () => {
  test("two people see each other in the panel, and nobody reads the board for it", async ({
    browser,
  }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("Presence"));
    const friendAccount = await register(friend.page, "Friend Person");
    await addMember(owner.page, projectId, friendAccount.email);

    await owner.page.goto(`/p/${projectId}`);
    await addTask(owner.page, "Todo", "Looked at by two");
    await owner.page.getByRole("button", { name: "Close task" }).click();

    await friend.page.goto(`/p/${projectId}`);
    await expect(friend.page.getByTestId("live-dot")).toBeVisible();
    await card(friend.page, "Looked at by two").click();
    await expect(friend.page.getByTestId("task-key")).toBeVisible();

    const boardReads: string[] = [];
    friend.page.on("request", (req) => {
      if (/\/api\/projects\/[^/]+\/board$/.test(new URL(req.url()).pathname)) {
        boardReads.push(req.url());
      }
    });

    await card(owner.page, "Looked at by two").click();
    await expect(faces(friend.page)).toHaveCount(1, { timeout: 2_000 });
    await expect(faces(friend.page)).toHaveAttribute("data-name", "Owner Person");
    await expect(faces(owner.page)).toHaveCount(1, { timeout: 2_000 });
    await expect(faces(owner.page)).toHaveAttribute("data-name", "Friend Person");

    // The name shows on focus too, where a title never would.
    await owner.page.getByTestId("task-key").focus();
    await owner.page.keyboard.press("Tab");
    await expect(faces(owner.page)).toBeFocused();
    await expect(owner.page.getByText("Has this task open.")).toBeVisible();

    // A second tab of the friend is still one face, and never the friend's own.
    const second = await friend.context.newPage();
    await second.goto(`/p/${projectId}`);
    await card(second, "Looked at by two").click();
    await expect(faces(second)).toHaveCount(1, { timeout: 2_000 });
    await expect(faces(second)).toHaveAttribute("data-name", "Owner Person");
    await owner.page.waitForTimeout(1_000);
    await expect(faces(owner.page)).toHaveCount(1);
    await second.close();

    await owner.page.getByRole("button", { name: "Close task" }).click();
    await expect(faces(friend.page)).toHaveCount(0, { timeout: 2_000 });

    expect(boardReads).toEqual([]);

    await owner.context.close();
    await friend.context.close();
  });

  test("a tab that closes the board goes at once, and one that dies goes with its lease", async ({
    browser,
  }) => {
    const owner = await freshPage(browser);
    const friend = await freshPage(browser);

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("Lease"));
    const friendAccount = await register(friend.page, "Friend Person");
    await addMember(owner.page, projectId, friendAccount.email);

    await owner.page.clock.install();
    await owner.page.goto(`/p/${projectId}`);
    await addTask(owner.page, "Todo", "Watched");
    const taskId = await taskIdOf(owner.page, projectId, "Watched");

    // The friend opens the task in a real tab, then leaves the board.
    await friend.page.goto(`/p/${projectId}`);
    await card(friend.page, "Watched").click();
    await expect(faces(owner.page)).toHaveCount(1, { timeout: 2_000 });
    await friend.page.goto("/projects");
    await expect(faces(owner.page)).toHaveCount(0, { timeout: 2_000 });

    // A tab that says it once and is never heard again: a crash.
    expect((await sayFrom(friend.context, projectId, taskId)).status()).toBe(200);
    await expect(faces(owner.page)).toHaveCount(1, { timeout: 2_000 });
    await owner.page.clock.fastForward(30_000);
    await expect(faces(owner.page)).toHaveCount(1);
    await owner.page.clock.fastForward(35_000);
    await expect(faces(owner.page)).toHaveCount(0);

    await owner.context.close();
    await friend.context.close();
  });

  test("three faces fit the header of a phone", async ({ browser }) => {
    const owner = await freshPage(browser);
    const others = await Promise.all([1, 2, 3].map(() => freshPage(browser)));

    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("Phone"));
    const names = ["Ada Lovelace", "Grace Hopper", "Barbara Liskov"];
    for (const [i, other] of others.entries()) {
      const account = await register(other.page, names[i]);
      await addMember(owner.page, projectId, account.email);
    }

    await owner.page.goto(`/p/${projectId}`);
    await addTask(owner.page, "Todo", "Crowded");
    const taskId = await taskIdOf(owner.page, projectId, "Crowded");
    await owner.page.setViewportSize({ width: 390, height: 844 });
    await expect(owner.page.getByTestId("task-key")).toBeVisible();

    for (const other of others) {
      expect((await sayFrom(other.context, projectId, taskId)).status()).toBe(200);
    }
    await expect(faces(owner.page)).toHaveCount(3, { timeout: 2_000 });

    const head = owner.page.getByTestId("task-key").locator("xpath=..");
    const row = (await head.boundingBox())!;
    for (const button of ["Task menu", "Close task"]) {
      const box = (await owner.page.getByRole("button", { name: button }).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }

    await owner.context.close();
    for (const other of others) await other.context.close();
  });

  test("an agent may not say it has a task open", async ({ browser, request }) => {
    const owner = await freshPage(browser);
    await register(owner.page, "Owner Person");
    const projectId = await createProject(owner.page, unique("Agents"));

    await gotoSettings(owner.page, projectId, "people");
    await owner.page.getByLabel("Name of the new agent").fill("Builder");
    await owner.page.getByRole("button", { name: "Add agent" }).click();
    const box = owner.page.getByTestId("agent-box").filter({ hasText: "Builder" });
    await box.getByRole("button", { name: "Connect" }).click();
    const token = (
      (await owner.page
        .getByTestId("agent-secret")
        .first()
        .locator("code")
        .first()
        .textContent()) ?? ""
    ).trim();

    const res = await request.post(`/api/projects/${projectId}/presence`, {
      headers: { Authorization: `Bearer ${token}`, "x-ushabti-client": randomUUID() },
      data: { taskId: null, field: null },
    });
    expect(res.status()).toBe(403);

    await owner.context.close();
  });
});
