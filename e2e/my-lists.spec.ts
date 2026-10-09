import { expect, test, type Page } from "@playwright/test";
import { addTask, card, createProject, overflow, register, settles, unique } from "./helpers";

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
  /* Projects lead; lists and charts follow. */
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Projects",
    "My lists",
    "Charts",
  ]);

  await page.getByTestId("list-new").click();
  await page.waitForURL(/\/lists\/new$/);
  const name = page.getByTestId("list-name");
  await expect(name).toHaveValue("New list");
  await name.fill("My todo");
  await name.press("Tab");

  /* The first project writes the list, its name and the project in one request. */
  await settles(page, /\/api\/lists$/, () =>
    page.getByTestId("list-add-project").filter({ hasText: oneKey }).click(),
  );
  await page.waitForURL(/\/lists\/[0-9a-f-]{36}\/edit$/);
  await expect(name).toHaveValue("My todo");
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
  await expect(page.getByTestId("list-group").filter({ hasText: oneKey }).first()).toContainText(
    "Status is Todo",
  );

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

  const oneKey = await keyOf(page, one);

  await page.goto("/projects");
  await page.getByTestId("list-new").click();
  await page.waitForURL(/\/lists\/new$/);
  await page.getByTestId("list-add-project").filter({ hasText: oneKey }).click();
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

async function newList(page: Page, name: string, projectIds: string[]): Promise<string> {
  const [first, ...rest] = projectIds;
  const res = await page.request.post("/api/lists", { data: { name, projectId: first } });
  expect(res.status()).toBe(201);
  const { list } = await res.json();
  for (const projectId of rest) {
    await page.request.post(`/api/lists/${list.id}/sources`, { data: { projectId } });
  }
  return list.id as string;
}

async function addTasks(page: Page, projectId: string, titles: string[]) {
  for (const title of titles) {
    const res = await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } });
    expect(res.ok()).toBe(true);
  }
}

test("a list card shows its first five tasks and opens each one", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await register(page, "List Reader");
  /* A new project joins the top of Home, so the one made last lists first. */
  const two = await createProject(page, unique("More"));
  await addTasks(page, two, ["Five", "Six", "Seven"]);
  const one = await createProject(page, unique("Rows"));
  await addTasks(page, one, ["One", "Two", "Three", "Four"]);
  const empty = await createProject(page, unique("Bare"));
  const gone = await createProject(page, unique("Gone"));
  const oneKey = await keyOf(page, one);
  const twoKey = await keyOf(page, two);
  const seven = await newList(page, "Seven tasks", [one, two]);
  await newList(page, "Matches none", [empty]);
  await newList(page, "From nowhere", [gone]);
  expect((await page.request.delete(`/api/projects/${gone}`)).ok()).toBe(true);

  await page.goto("/projects");
  const full = listCard(page, "Seven tasks");
  await expect(full).toBeVisible();
  await expect(full.getByTestId("list-count")).toHaveText("7");
  const rows = full.getByTestId("list-card-row");
  await expect(rows).toHaveText([
    `${oneKey}-1One`,
    `${oneKey}-2Two`,
    `${oneKey}-3Three`,
    `${oneKey}-4Four`,
    `${twoKey}-1Five`,
  ]);
  await expect(full.getByTestId("list-card-more")).toHaveText("+2 more");
  await expect(full.getByTestId("list-source")).toHaveCount(0);
  await expect(listCard(page, "Matches none").getByTestId("list-empty")).toHaveText(
    "Nothing here.",
  );
  await expect(listCard(page, "Matches none").getByTestId("list-count")).toHaveText("0");
  await expect(listCard(page, "From nowhere").getByTestId("list-empty")).toHaveText(
    "Nothing here.",
  );
  await expect(page.locator('[data-testid="list-card"] a a')).toHaveCount(0);
  await expect(page.locator('a [data-testid="list-card"], a[data-testid="list-card"]')).toHaveCount(
    0,
  );

  /* The column is 1200 wide, and three list cards of at least 340 sit across. */
  const body = await page.getByTestId("my-lists").boundingBox();
  expect(body!.width).toBeGreaterThan(1100);
  expect(body!.width).toBeLessThanOrEqual(1200);
  const cards = [full, listCard(page, "Matches none"), listCard(page, "From nowhere")];
  const boxes = await Promise.all(cards.map(async (c) => (await c.boundingBox())!));
  const across = boxes.filter((b) => Math.abs(b.y - boxes[0].y) < 1);
  expect(across).toHaveLength(3);
  for (const b of boxes) {
    expect(b.width).toBeGreaterThanOrEqual(340);
    expect(Math.round(b.height)).toBe(Math.round(boxes[0].height));
  }

  await rows.filter({ hasText: "Two" }).click();
  await page.waitForURL(new RegExp(`/p/${one}\\?task=${oneKey}-2$`));
  await expect(page.getByTestId("task-panel")).toContainText("Two");

  await page.goto("/projects");
  await listCard(page, "Seven tasks").getByTestId("list-card-more").click();
  await page.waitForURL(new RegExp(`/lists/${seven}$`));
  await expect(page.getByTestId("list-row")).toHaveCount(7);

  await page.goto("/projects");
  await listCard(page, "Seven tasks").getByTestId("list-name-link").click();
  await page.waitForURL(new RegExp(`/lists/${seven}$`));

  /* A phone stacks every section to one column, and nothing scrolls sideways. */
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/projects");
  await expect(full).toBeVisible();
  await expect(full.getByTestId("list-card-row")).toHaveCount(5);
  expect(await overflow(page)).toBe(0);
  const a = (await full.boundingBox())!;
  const b = (await listCard(page, "Matches none").boundingBox())!;
  expect(b.y).toBeGreaterThan(a.y + a.height - 1);
});

test("a new list is written only with its first project, and keeps its last one", async ({
  page,
}) => {
  await register(page, "List Keeper");
  const one = await createProject(page, unique("Kept"));
  const two = await createProject(page, unique("Extra"));
  const oneKey = await keyOf(page, one);
  const twoKey = await keyOf(page, two);
  const lists = async () =>
    ((await (await page.request.get("/api/lists")).json()).lists as unknown[]).length;

  /* Leaving the unsaved editor writes nothing, whatever was typed. */
  await page.goto("/projects");
  const before = await page.getByTestId("list-card").count();
  await page.getByTestId("list-new").click();
  await page.waitForURL(/\/lists\/new$/);
  await expect(page.getByTestId("list-needs-project")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete list" })).toHaveCount(0);
  await page.getByTestId("list-name").fill("Never saved");
  await page.getByTestId("list-name").press("Tab");
  await page.goto("/projects");
  await expect(page.getByTestId("list-card")).toHaveCount(before);
  await expect(listCard(page, "Never saved")).toHaveCount(0);
  expect(await lists()).toBe(0);

  await page.getByTestId("list-new").click();
  await page.waitForURL(/\/lists\/new$/);
  await settles(page, /\/api\/lists$/, () =>
    page.getByTestId("list-add-project").filter({ hasText: oneKey }).click(),
  );
  await page.waitForURL(/\/lists\/[0-9a-f-]{36}\/edit$/);
  expect(await lists()).toBe(1);

  /* The only project cannot leave, and the button says why. */
  const remove = page.getByTestId("list-source-remove");
  await expect(remove).toHaveCount(1);
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAttribute(
    "title",
    "A list needs a project. Delete the list to remove it.",
  );

  await settles(page, /\/sources$/, () =>
    page.getByTestId("list-add-project").filter({ hasText: twoKey }).click(),
  );
  await expect(remove).toHaveCount(2);
  await expect(remove.first()).toBeEnabled();
  await settles(page, /\/sources\/[0-9a-f-]+$/, () => remove.first().click());
  await expect(remove).toHaveCount(1);
  await expect(remove).toBeDisabled();

  await page.reload();
  await expect(page.getByTestId("list-source-edit")).toHaveCount(1);
});
