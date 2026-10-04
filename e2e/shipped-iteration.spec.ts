import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  card,
  column,
  createProject,
  dragCard,
  gotoSettings,
  propertyBox,
  register,
  unique,
} from "./helpers";

/**
 * A shipped sprint leaves every screen that offers a choice, and stays on the
 * tasks that hold it. A shipped version stays everywhere: there are few, and
 * people pick old ones on purpose.
 */

type Option = { id: string; name: string };
type Board = {
  properties: { id: string; name: string; options: Option[] }[];
  views: { id: string; isDefault: boolean }[];
  tasks: { title: string; values: Record<string, unknown> }[];
};

async function board(page: Page, projectId: string): Promise<Board> {
  return (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as Board;
}

/** A property with three options whose first one has shipped. */
async function shippedFirst(page: Page, projectId: string, name: string, type: string) {
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name, type, options: [`${name[0]}1`, `${name[0]}2`, `${name[0]}3`] },
  });
  expect(made.status()).toBe(201);
  const property = (await board(page, projectId)).properties.find((p) => p.name === name)!;
  if (type === "select") {
    const dated = await page.request.patch(`/api/properties/${property.id}`, {
      data: { dated: true },
    });
    expect(dated.ok()).toBeTruthy();
  }
  /* Only an option with a target date can ship. */
  const targeted = await page.request.patch(`/api/options/${property.options[0].id}`, {
    data: { targetAt: new Date().toISOString().slice(0, 10) },
  });
  expect(targeted.ok()).toBeTruthy();
  const shipped = await page.request.post(`/api/options/${property.options[0].id}/ship`, {
    data: { rest: "leave" },
  });
  expect(shipped.ok()).toBeTruthy();
  return property;
}

async function addTaskWith(page: Page, projectId: string, title: string, values: object) {
  const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title, values },
  });
  expect(res.ok()).toBeTruthy();
}

function field(page: Page, name: string) {
  return page.getByTestId("task-panel").locator(`[data-property="${name}"]`);
}

test("a shipped sprint leaves the board, the picker and the filter list, and stays on its task", async ({
  page,
}) => {
  await register(page);
  const projectId = await createProject(page, unique("Shipped sprint"));
  const sprint = await shippedFirst(page, projectId, "Sprint", "iteration");
  const [s1] = sprint.options;
  await addTaskWith(page, projectId, "Old work", { [sprint.id]: s1.id });
  await addTaskWith(page, projectId, "New work", {});

  /* ---- the card still names its sprint ------------------------------- */

  /* A board grouped by Status draws the sprint on the card. One grouped by
     the sprint does not, for any option: the column says it. */
  await page.goto(`/p/${projectId}`);
  await expect(card(page, "Old work")).toContainText("S1");

  /* ---- no column for it ---------------------------------------------- */

  const main = (await board(page, projectId)).views.find((v) => v.isDefault)!;
  const grouped = await page.request.patch(`/api/views/${main.id}`, {
    data: { groupById: sprint.id },
  });
  expect(grouped.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("column-name")).toHaveText([/^S2$/i, /^S3$/i, /^no open sprint$/i]);
  await expect(column(page, "No open sprint").getByTestId("card")).toHaveCount(2);

  /* ---- the picker offers the open ones, plus the one a task holds ----- */

  /* An iteration's picker is a menu, so it can open on the current sprint. */
  const offered = (page: Page) =>
    field(page, "Sprint").getByRole("option").filter({ hasText: /^S\d/ });
  await card(page, "Old work").click();
  await field(page, "Sprint").getByRole("button", { name: /S1/ }).click();
  await expect(offered(page)).toHaveText([/^S1/, /^S2/, /^S3/]);
  await expect(offered(page).filter({ hasText: /^S1/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await card(page, "New work").click();
  await field(page, "Sprint").getByRole("button").click();
  await expect(offered(page)).toHaveText([/^S2/, /^S3/]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  /* ---- the filter keeps it behind one fold ---------------------------- */

  await page.getByTestId("filter-button").click();
  const search = page.getByTestId("filter-search");
  await search.fill("Sprint");
  await search.press("Enter");
  const rows = page.getByRole("option");
  await expect(rows.filter({ hasText: /^S1/ })).toHaveCount(0);
  await expect(rows.filter({ hasText: /^S2/ })).toHaveCount(1);
  const fold = rows.filter({ hasText: "Shipped" });
  await expect(fold).toContainText("1");
  await fold.click();
  await expect(rows.filter({ hasText: /^S1/ })).toHaveCount(1);
  /* A search reaches behind the fold without opening it. */
  await fold.click();
  await page.getByTestId("filter-box").fill("S1");
  await expect(rows.filter({ hasText: /^S1/ })).toHaveCount(1);

  /* A report on the old sprint keeps the column its cards live in. */
  const lens = page.waitForResponse((r) => /\/api\/views\/[0-9a-f-]+\/lens$/.test(r.url()));
  await page.getByTestId("filter-box").press("Enter");
  expect((await lens).ok()).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("column-name")).toHaveText([/^no open sprint$/i]);
  await expect(card(page, "Old work")).toBeVisible();
  await expect(card(page, "New work")).toHaveCount(0);
});

/** A board grouped by a sprint whose S1 shipped: two cards on S1, one on S2. */
async function sprintBoard(page: Page, name: string) {
  await register(page);
  const projectId = await createProject(page, unique(name));
  const sprint = await shippedFirst(page, projectId, "Sprint", "iteration");
  const [s1, s2] = sprint.options;
  await addTaskWith(page, projectId, "Old one", { [sprint.id]: s1.id });
  await addTaskWith(page, projectId, "Old two", { [sprint.id]: s1.id });
  await addTaskWith(page, projectId, "Open work", { [sprint.id]: s2.id });
  const main = (await board(page, projectId)).views.find((v) => v.isDefault)!;
  const grouped = await page.request.patch(`/api/views/${main.id}`, {
    data: { groupById: sprint.id },
  });
  expect(grouped.ok()).toBeTruthy();
  return { projectId, sprint, s1, s2, viewId: main.id };
}

/* The board reads itself again as it opens, so a card can be drawn anew in
   the moment its box is asked. Wait until it holds still. */
async function boxOf(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("The card is not on the page");
  return box;
}

async function sprintOf(page: Page, projectId: string, sprintId: string, title: string) {
  const task = (await board(page, projectId)).tasks.find((t) => t.title === title)!;
  return task.values[sprintId] ?? null;
}

test("a shipped sprint's card dragged inside No open sprint keeps its sprint", async ({ page }) => {
  const { projectId, sprint, s1 } = await sprintBoard(page, "Shipped drag");
  await page.goto(`/p/${projectId}`);
  const none = column(page, "No open sprint");
  await expect(none.getByTestId("card")).toHaveText([/Old one/, /Old two/]);

  /* Old two goes above Old one. The drag writes its rank and nothing else. */
  const above = await boxOf(card(page, "Old one"));
  await dragCard(page, "Old two", { x: above.x + above.width / 2, y: above.y + 4 });
  await expect(none.getByTestId("card")).toHaveText([/Old two/, /Old one/]);
  expect(await sprintOf(page, projectId, sprint.id, "Old two")).toBe(s1.id);

  await page.reload();
  await expect(none.getByTestId("card")).toHaveText([/Old two/, /Old one/]);
});

test("under a filter that no sprint fails, No open sprint takes no drop and no new task", async ({
  page,
}) => {
  const { projectId, sprint, s1, s2, viewId } = await sprintBoard(page, "Shipped refuse");
  const filtered = await page.request.patch(`/api/views/${viewId}`, {
    data: { filters: { rules: [{ propertyId: sprint.id, op: "is", values: [s1.id, s2.id] }] } },
  });
  expect(filtered.ok()).toBeTruthy();
  await page.goto(`/p/${projectId}`);
  await expect(page.getByTestId("column-name")).toHaveText([/^S2$/i, /^no open sprint$/i]);
  const none = column(page, "No open sprint");
  await expect(none.getByTestId("card")).toHaveCount(2);

  /* No composer: a task written here would have no sprint and vanish. */
  await expect(none.getByRole("button", { name: /^Add a task/ })).toHaveCount(0);
  await expect(column(page, "S2").getByRole("button", { name: /^Add a task/ })).toHaveCount(2);
  /* `n` on a card of the column opens the composer in the first one that takes a task. */
  await card(page, "Old one").focus();
  await page.keyboard.press("n");
  await expect(column(page, "S2").getByRole("textbox")).toBeVisible();
  await page.keyboard.press("Escape");

  /* A card from S2 is not let in, and nothing is written. */
  const into = await boxOf(none.getByTestId("card").last());
  await dragCard(
    page,
    "Open work",
    { x: into.x + into.width / 2, y: into.y + into.height + 20 },
    null,
  );
  await expect(column(page, "S2").getByTestId("card")).toHaveText([/Open work/]);
  await expect(none.getByTestId("card")).toHaveCount(2);
  expect(await sprintOf(page, projectId, sprint.id, "Open work")).toBe(s2.id);

  /* A shipped card still moves inside the column and out of it. */
  const above = await boxOf(card(page, "Old one"));
  await dragCard(page, "Old two", { x: above.x + above.width / 2, y: above.y + 4 });
  await expect(none.getByTestId("card")).toHaveText([/Old two/, /Old one/]);
  expect(await sprintOf(page, projectId, sprint.id, "Old two")).toBe(s1.id);

  const s2Box = await boxOf(column(page, "S2").getByTestId("card").first());
  await dragCard(page, "Old one", { x: s2Box.x + s2Box.width / 2, y: s2Box.y + s2Box.height + 20 });
  await expect(column(page, "S2").getByTestId("card")).toHaveCount(2);
  expect(await sprintOf(page, projectId, sprint.id, "Old one")).toBe(s2.id);
});

test("Settings folds the shipped sprints behind one row, and unship works inside it", async ({
  page,
}) => {
  await register(page);
  const projectId = await createProject(page, unique("Shipped fold"));
  await shippedFirst(page, projectId, "Sprint", "iteration");
  await gotoSettings(page, projectId);

  const box = propertyBox(page, "Sprint");
  await expect(box.getByLabel("Start of S2")).toBeVisible();
  await expect(box.getByLabel("Start of S1")).toHaveCount(0);
  const fold = box.getByRole("button", { name: "1 shipped" });
  await expect(fold).toHaveAttribute("aria-expanded", "false");

  await fold.click();
  await expect(box.getByLabel("Start of S1")).toBeVisible();
  await expect(box.getByText(/^Shipped \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await box.getByRole("button", { name: "Unship S1" }).click();
  const unshipped = page.waitForResponse(
    (r) => /\/api\/options\/[0-9a-f-]+$/.test(r.url()) && r.request().method() === "PATCH",
  );
  await box.getByRole("button", { name: "Yes, unship" }).click();
  expect((await unshipped).ok()).toBeTruthy();

  await expect(box.getByRole("button", { name: /shipped$/ })).toHaveCount(0);
  await expect(box.getByLabel("Start of S1")).toBeVisible();
});

test("a shipped version of a dated select is drawn exactly as before", async ({ page }) => {
  await register(page);
  const projectId = await createProject(page, unique("Shipped version"));
  const version = await shippedFirst(page, projectId, "Version", "select");
  await addTaskWith(page, projectId, "Released work", {});

  const main = (await board(page, projectId)).views.find((v) => v.isDefault)!;
  await page.request.patch(`/api/views/${main.id}`, { data: { groupById: version.id } });
  await page.goto(`/p/${projectId}`);
  await expect(column(page, "V1")).toBeVisible();

  await card(page, "Released work").click();
  await expect(field(page, "Version").getByRole("button")).toHaveText(["V1", "V2", "V3"]);
  await page.keyboard.press("Escape");

  await gotoSettings(page, projectId);
  const box = propertyBox(page, "Version");
  await expect(box.getByLabel("Start of V1")).toBeVisible();
  await expect(box.getByRole("button", { name: /shipped$/ })).toHaveCount(0);
});
