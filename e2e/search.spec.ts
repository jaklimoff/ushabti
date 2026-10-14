import { expect, test } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;

function box(page: Page) {
  return page.getByTestId("search-box");
}

/** The rows the box is offering, top to bottom. */
function hits(page: Page) {
  return page.getByTestId("search-hit");
}

async function find(page: Page, words: string) {
  await box(page).fill(words);
  await expect(page.getByTestId("search-hits")).toBeVisible();
}

/*
 * The two walks with `@smoke` on them. The words, the arrows, the description,
 * a hidden hit and the `/` key are `src/components/board/Search.test.tsx`.
 */
test.describe("Finding a task", () => {
  test("finds a task by words in its title and opens it", { tag: "@smoke" }, async ({ page }) => {
    await register(page);
    await createProject(page, unique("Finding"));

    await addTask(page, "Todo", "Rate limit the sign-in route");
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "Backlog", "Ship the release image");
    await page.getByRole("button", { name: "Close task" }).click();

    await find(page, "release");
    await expect(hits(page)).toHaveCount(1);
    await expect(hits(page).first()).toContainText("Ship the release image");

    await box(page).press("Enter");
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(page.getByTestId("task-title")).toHaveValue("Ship the release image");
    // The list goes when a task is opened; the words stay, so the next hit is
    // one press away.
    await expect(page.getByTestId("search-hits")).toHaveCount(0);
    await expect(box(page)).toHaveValue("release");
  });

  test("finds a task by its key, and by the number alone", { tag: "@smoke" }, async ({ page }) => {
    await register(page);
    await createProject(page, unique("Keys"));

    await addTask(page, "Todo", "The one we want");
    const key = await page.getByTestId("task-key").innerText();
    await page.getByRole("button", { name: "Close task" }).click();

    await find(page, key.toLowerCase());
    await expect(hits(page)).toHaveCount(1);
    await expect(hits(page).first()).toContainText("The one we want");

    await find(page, key.split("-")[1]);
    await expect(hits(page).first()).toContainText("The one we want");
  });
});

/*
 * The board read carries an archived task without its description, and the
 * server looks through those words instead. Only a real database runs the
 * query, so this one stays end to end.
 */
test("finds an archived task by a word in its description", async ({ page }, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Shelf"));

  const make = async (title: string, description: string) => {
    const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title, description, values: {} },
    });
    expect(made.ok()).toBeTruthy();
    return (await made.json()).task as { id: string };
  };
  await make("Open work on the queue", "");
  const old = await make("Long gone", "First line.\nThe queue survives a reload.");
  await make("Also gone", "Nothing to see.");
  expect((await page.request.post(`/api/tasks/${old.id}/archive`)).ok()).toBeTruthy();

  const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const shelved = board.archived.find((t: { id: string }) => t.id === old.id);
  expect(shelved.title).toBe("Long gone");
  expect(shelved).not.toHaveProperty("description");

  await page.reload();
  await find(page, "queue survives");
  await expect(hits(page)).toHaveCount(1);
  await expect(hits(page).first()).toContainText("Long gone");
  await expect(hits(page).first()).toContainText("archived");
  await expect(hits(page).first()).toContainText("The queue survives a reload.");

  // The open task the title answers comes first; the archived one joins below.
  await find(page, "queue");
  await expect(hits(page)).toHaveCount(2);
  await expect(hits(page).nth(0)).toContainText("Open work on the queue");
  await expect(hits(page).nth(1)).toContainText("Long gone");
  await page.screenshot({ path: testInfo.outputPath("seen-archived-search.png") });

  await hits(page).nth(1).click();
  await expect(page.getByTestId("task-title")).toHaveValue("Long gone");
});
