import { expect, test, type Page } from "@playwright/test";
import { addTask, card, createProject, register, settles, unique } from "./helpers";

/*
 * A list is one person's tasks from several projects. This walks the whole
 * flow once: Home, a new list, two sources, the list, and a task opened from
 * it on its own board. The reading of sources is unit and route tested.
 */

async function keyOf(page: Page, projectId: string): Promise<string> {
  const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  return board.project.key as string;
}

const listCard = (page: Page, name: string) =>
  page.getByTestId("list-card").filter({ hasText: name });

test("a list made on Home opens a task on its own board @smoke", async ({ page }) => {
  await register(page, "List Person");
  const one = await createProject(page, unique("Alpha"));
  await addTask(page, "Todo", "Todo work");
  await addTask(page, "Backlog", "Backlog work");
  const two = await createProject(page, unique("Beta"));
  await addTask(page, "Todo", "Other work");
  const oneKey = await keyOf(page, one);
  const twoKey = await keyOf(page, two);

  await page.goto("/projects");
  await expect(page).toHaveTitle("Home · Ushabti");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Home");
  const lists = await page.getByRole("heading", { name: "My lists" }).boundingBox();
  const projects = await page.getByRole("heading", { name: "Projects" }).boundingBox();
  expect(lists!.y).toBeLessThan(projects!.y);

  await page.getByTestId("list-new").click();
  await page.waitForURL(/\/lists\/[0-9a-f-]{36}\/edit$/);
  const name = page.getByTestId("list-name");
  await expect(name).toHaveValue("New list");
  await name.fill("My todo");
  await settles(page, /\/api\/lists\/[0-9a-f-]+$/, () => name.press("Tab"));

  await settles(page, /\/sources$/, () =>
    page.getByTestId("list-add-project").filter({ hasText: oneKey }).click(),
  );
  const source = page.getByTestId("list-source-edit").filter({ hasText: oneKey });
  await source.getByTestId("rule-add").click();
  const search = page.getByTestId("filter-search");
  await search.fill("Status");
  await search.press("Enter");
  const box = page.getByTestId("filter-box");
  await box.fill("Todo");
  await settles(page, /\/sources\/[0-9a-f-]+$/, () => box.press("Enter"));
  await page.keyboard.press("Escape");
  await expect(source.getByTestId("filter-chip")).toHaveText("Status is Todo");

  await settles(page, /\/sources$/, () =>
    page.getByTestId("list-add-project").filter({ hasText: twoKey }).click(),
  );
  await expect(page.getByTestId("list-add-project")).toHaveCount(0);

  await page.getByTestId("list-open").click();
  await page.waitForURL(/\/lists\/[0-9a-f-]{36}$/);
  const listUrl = page.url();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My todo");
  const rows = page.getByTestId("list-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Todo work" })).toBeVisible();
  await expect(rows.filter({ hasText: "Other work" })).toBeVisible();
  await expect(rows.filter({ hasText: "Backlog work" })).toHaveCount(0);
  await expect(page.getByTestId("list-group").first()).toContainText("Status is Todo");

  await rows.filter({ hasText: "Todo work" }).click();
  await page.waitForURL(new RegExp(`/p/${one}\\?task=${oneKey}-`));
  await expect(page.getByTestId("task-panel")).toContainText("Todo work");

  await page.goBack();
  await page.waitForURL(listUrl);
  await expect(page.getByTestId("list-row")).toHaveCount(2);

  await page.goto("/projects");
  await expect(listCard(page, "My todo").getByTestId("list-count")).toHaveText("2");
});

test("a list keeps a name typed before the tab went, and goes without its tasks", async ({
  page,
}) => {
  await register(page, "List Leaver");
  const one = await createProject(page, unique("Gamma"));
  await addTask(page, "Todo", "Survives the list");

  await page.goto("/projects");
  await page.getByTestId("list-new").click();
  await page.waitForURL(/\/lists\/[0-9a-f-]{36}\/edit$/);
  const editUrl = page.url();
  const name = page.getByTestId("list-name");
  await expect(name).toHaveValue("New list");
  // No blur: the page goes with the cursor still in the box.
  await name.fill("Typed and left");
  await page.goto("/projects");
  await expect(async () => {
    await page.reload();
    await expect(listCard(page, "Typed and left")).toBeVisible({ timeout: 1000 });
  }).toPass();

  await page.goto(editUrl);
  await page.getByRole("button", { name: "Delete list" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("The tasks stay");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete list" }).click();
  await page.waitForURL("**/projects");
  await expect(listCard(page, "Typed and left")).toHaveCount(0);

  await page.goto(`/p/${one}`);
  await expect(card(page, "Survives the list")).toBeVisible();
});
