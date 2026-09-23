import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  addTask,
  card,
  createProject,
  gotoSettings,
  inDatabase,
  register,
  unique,
} from "./helpers";

/**
 * Two people write the same words. Fields save on blur, so the second blur
 * used to win in silence. Now the second one is refused, and the field asks,
 * in place, which words stay.
 */

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** Anna owns a project with one task, Ben is a member, and both have it open. */
async function twoPeople(browser: Browser) {
  const anna = await freshPage(browser);
  const ben = await freshPage(browser);
  await register(anna.page, "Anna Owner");
  const projectId = await createProject(anna.page, unique("Clash"));
  const benAccount = await register(ben.page, "Ben Friend");

  await gotoSettings(anna.page, projectId, "people");
  await anna.page.getByLabel("Email of the new member").fill(benAccount.email);
  await anna.page.getByRole("button", { name: "Add member" }).click();
  await expect(anna.page.getByText(benAccount.email)).toBeVisible();

  await anna.page.goto(`/p/${projectId}`);
  await addTask(anna.page, "Todo", "Shared words");
  await expect(anna.page.getByTestId("task-panel")).toBeVisible();

  await ben.page.goto(`/p/${projectId}`);
  await expect(ben.page.getByTestId("live-dot")).toBeVisible();
  await card(ben.page, "Shared words").click();
  await expect(ben.page.getByTestId("task-panel")).toBeVisible();

  const close = async () => {
    await anna.context.close();
    await ben.context.close();
  };
  return { anna: anna.page, ben: ben.page, projectId, close };
}

/** Runs `action` and answers the status of the text save it sends. */
async function statusOf(page: Page, url: RegExp, action: () => Promise<void>) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => url.test(r.url()) && r.request().method() === "PATCH"),
    action(),
  ]);
  return response.status();
}

const TASK = /\/api\/tasks\/[0-9a-f-]+$/;
const ITEM = /\/api\/checklist\/[0-9a-f-]+$/;

async function saved(projectId: string) {
  return inDatabase(async (client) => {
    const { rows } = await client.query<{ title: string; description: string }>(
      "SELECT title, description FROM tasks WHERE project_id = $1",
      [projectId],
    );
    return rows[0];
  });
}

test.describe("A text save does not overwrite a change it did not see", () => {
  test("the description asks in place, and Keep mine saves the second words", async ({
    browser,
  }) => {
    const { anna, ben, projectId, close } = await twoPeople(browser);

    await ben.getByText("Add a description…").click();
    await ben.getByPlaceholder("Write in markdown…").fill("Ben wrote this.");

    await anna.getByText("Add a description…").click();
    const annaEditor = anna.getByPlaceholder("Write in markdown…");
    await annaEditor.fill("Anna wrote this.");
    expect(await statusOf(anna, TASK, () => annaEditor.press("ControlOrMeta+Enter"))).toBe(200);

    const benEditor = ben.getByPlaceholder("Write in markdown…");
    expect(await statusOf(ben, TASK, () => benEditor.press("ControlOrMeta+Enter"))).toBe(409);
    expect((await saved(projectId)).description).toBe("Anna wrote this.");

    const question = ben.getByTestId("changed-while-typing");
    await expect(question).toContainText("This changed while you typed");
    await expect(question).toContainText("Anna Owner saved it first");
    await expect(question.getByTestId("changed-theirs")).toHaveText("Anna wrote this.");
    await expect(question.getByTestId("changed-mine")).toHaveText("Ben wrote this.");
    await expect(ben.getByRole("dialog")).toHaveCount(0);
    await expect(ben.getByRole("alertdialog")).toHaveCount(0);

    expect(
      await statusOf(ben, TASK, () => question.getByRole("button", { name: "Keep mine" }).click()),
    ).toBe(200);
    await expect(question).toHaveCount(0);
    await expect(ben.getByTestId("markdown")).toHaveText("Ben wrote this.");
    expect((await saved(projectId)).description).toBe("Ben wrote this.");
    await expect(anna.getByTestId("markdown")).toHaveText("Ben wrote this.", { timeout: 15_000 });

    await close();
  });

  test("the title asks too, and Take theirs drops the second words", async ({ browser }) => {
    const { anna, ben, projectId, close } = await twoPeople(browser);

    await ben.getByTestId("task-title").fill("Ben's title");

    const annaTitle = anna.getByTestId("task-title");
    await annaTitle.fill("Anna's title");
    expect(await statusOf(anna, TASK, () => annaTitle.press("Enter"))).toBe(200);

    expect(await statusOf(ben, TASK, () => ben.getByTestId("task-title").press("Enter"))).toBe(409);
    const question = ben.getByTestId("changed-while-typing");
    await expect(question).toContainText("This changed while you typed");
    await expect(question.getByTestId("changed-theirs")).toHaveText("Anna's title");
    await expect(question.getByTestId("changed-mine")).toHaveText("Ben's title");

    await question.getByRole("button", { name: "Take theirs" }).click();
    await expect(question).toHaveCount(0);
    await expect(ben.getByTestId("task-title")).toHaveValue("Anna's title");
    expect((await saved(projectId)).title).toBe("Anna's title");

    await close();
  });

  test("a checklist item's words ask in place, and name nobody", async ({ browser }) => {
    const { anna, ben, close } = await twoPeople(browser);

    await anna.getByRole("button", { name: "Add item" }).click();
    const adding = anna.getByPlaceholder("What has to be true?");
    await adding.fill("First step");
    await adding.press("Enter");
    await adding.press("Escape");

    await ben.getByText("First step").click({ timeout: 15_000 });
    const benBox = ben.getByTestId("task-panel").locator("input[value='First step']");
    await benBox.fill("Ben's step");

    await anna.getByText("First step").click();
    const annaBox = anna.getByTestId("task-panel").locator("input[value='First step']");
    await annaBox.fill("Anna's step");
    expect(await statusOf(anna, ITEM, () => annaBox.press("Enter"))).toBe(200);

    expect(await statusOf(ben, ITEM, () => benBox.press("Enter"))).toBe(409);
    const question = ben.getByTestId("changed-while-typing");
    await expect(question).toHaveText(/This changed while you typed\./);
    await expect(question).not.toContainText("saved it first");
    await expect(question.getByTestId("changed-theirs")).toHaveText("Anna's step");

    expect(
      await statusOf(ben, ITEM, () => question.getByRole("button", { name: "Keep mine" }).click()),
    ).toBe(200);
    await expect(question).toHaveCount(0);
    await expect(ben.getByText("Ben's step")).toBeVisible();
    await expect(anna.getByText("Ben's step")).toBeVisible({ timeout: 15_000 });

    await close();
  });

  test("a Priority change and a tick do not refuse a description", async ({ browser }) => {
    const { anna, ben, projectId, close } = await twoPeople(browser);

    await anna.getByRole("button", { name: "Add item" }).click();
    const adding = anna.getByPlaceholder("What has to be true?");
    await adding.fill("Tick me");
    await adding.press("Enter");
    await adding.press("Escape");
    await expect(ben.getByText("Tick me")).toBeVisible({ timeout: 15_000 });

    await ben.getByText("Add a description…").click();
    await ben.getByPlaceholder("Write in markdown…").fill("Words after a tick.");

    const ids = await inDatabase(async (client) => {
      const { rows } = await client.query<{ task: string; property: string; option: string }>(
        `SELECT t.id AS task, p.id AS property, o.id AS option
           FROM tasks t
           JOIN properties p ON p.project_id = t.project_id AND p.name = 'Priority'
           JOIN property_options o ON o.property_id = p.id
          WHERE t.project_id = $1
          LIMIT 1`,
        [projectId],
      );
      return rows[0];
    });
    const priority = await anna.request.put(`/api/tasks/${ids.task}/values/${ids.property}`, {
      data: { value: ids.option },
    });
    expect(priority.ok()).toBeTruthy();
    await anna.getByRole("button", { name: "Mark as done" }).click();
    await expect(anna.getByText("1 / 1")).toBeVisible();

    const editor = ben.getByPlaceholder("Write in markdown…");
    expect(await statusOf(ben, TASK, () => editor.press("ControlOrMeta+Enter"))).toBe(200);
    await expect(ben.getByTestId("changed-while-typing")).toHaveCount(0);
    expect((await saved(projectId)).description).toBe("Words after a tick.");

    await close();
  });
});
