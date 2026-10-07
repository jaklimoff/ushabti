import { expect, test, type Page } from "@playwright/test";
import {
  addListView,
  addTask,
  card,
  createProject,
  gotoSettings,
  inDatabase,
  listHead,
  listOrder,
  register,
  saved,
  settles,
  unique,
} from "./helpers";

/**
 * Created and Updated are two rows of the card view, two words a filter asks
 * about and two orders a view can run in. Every task has both, so neither is
 * drawn until somebody asks for it.
 */

/** The row of the card view page that names one row. */
function row(page: Page, name: string) {
  return page.getByTestId("card-row").filter({
    has: page.getByRole("button", { name: new RegExp(`^${name} on the card`) }),
  });
}

async function turnOn(page: Page, projectId: string, name: string) {
  await gotoSettings(page, projectId, "card");
  await row(page, name)
    .getByRole("button", { name: new RegExp(`^${name} on the card`) })
    .click();
  await saved(page, () =>
    page.getByRole("button", { name: `Put ${name} in the footer left` }).click(),
  );
  await expect(row(page, name)).toHaveAttribute("data-place", "footerL");
}

async function makeTask(page: Page, projectId: string, title: string) {
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } });
  expect(made.ok()).toBeTruthy();
  return ((await made.json()) as { task: { id: string } }).task.id;
}

async function stamp(taskId: string, at: string) {
  await inDatabase((c) =>
    c.query("update tasks set created_at = $1, updated_at = $1 where id = $2", [at, taskId]),
  );
}

const DAYS = 86_400_000;

test("Created and Updated wait to be turned on, then read on the card and in a list", async ({
  page,
}) => {
  await register(page);
  const projectId = await createProject(page, unique("Stamps"));
  await addTask(page, "Todo", "Stamped");
  await page.getByRole("button", { name: "Close task" }).click();

  const chips = card(page, "Stamped").getByTestId("card-chip");
  await expect(chips.filter({ hasText: /^Created|^Updated/ })).toHaveCount(0);
  await expect(card(page, "Stamped").locator('[title^="Updated"]')).toHaveCount(0);
  await expect(card(page, "Stamped").locator('[title^="Created"]')).toHaveCount(0);

  await turnOn(page, projectId, "Updated");
  await page.goto(`/p/${projectId}`);
  await expect(card(page, "Stamped").locator('[title^="Updated · "]')).toHaveCount(1);
  await expect(card(page, "Stamped").locator('[title^="Created"]')).toHaveCount(0);

  await addListView(page, "Rows");
  await expect(listHead(page, "Updated")).toHaveCount(1);
  await expect(listHead(page, "Created")).toHaveCount(0);
});

/*
 * The browser is never on the project's day: Kiritimati is UTC+14 and the
 * project sits on UTC−12. A window worked out in the browser's zone would draw
 * one set of cards on the server and another after hydration.
 */
test.describe("Updated within the last 30 days", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  test("reads the same on the server and in the browser, and never asks is empty", async ({
    page,
  }) => {
    const noise: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") noise.push(message.text());
    });
    page.on("pageerror", (error) => noise.push(error.message));

    await register(page);
    const projectId = await createProject(page, unique("Untouched"));
    const zone = await page.request.patch(`/api/projects/${projectId}`, {
      data: { timeZone: "Etc/GMT+12" },
    });
    expect(zone.ok()).toBeTruthy();

    const fresh = await makeTask(page, projectId, "Touched lately");
    const stale = await makeTask(page, projectId, "Nobody touched it");
    await stamp(fresh, new Date(Date.now() - 2 * DAYS).toISOString());
    await stamp(stale, new Date(Date.now() - 40 * DAYS).toISOString());

    const board = await page.request.get(`/api/projects/${projectId}/board`);
    const { views } = (await board.json()) as { views: { id: string }[] };
    const lens = await page.request.put(`/api/views/${views[0].id}/lens`, {
      data: {
        filters: { rules: [{ propertyId: "_updated", op: "within", text: "last_30" }] },
        sort: null,
      },
    });
    expect(lens.ok()).toBeTruthy();

    /* The page as the server drew it, before any script ran. */
    const html = await (await page.request.get(`/p/${projectId}`)).text();
    /* A drawn title closes its element; the data behind the page carries
       every task, so the bare words would be found either way. */
    expect(html).toContain(">Touched lately<");
    expect(html).not.toContain(">Nobody touched it<");

    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Touched lately")).toHaveCount(1);
    await expect(card(page, "Nobody touched it")).toHaveCount(0);
    await expect(page.getByTestId("filter-chip")).toContainText("Updated in the last 30 days");
    await page.reload();
    await expect(card(page, "Touched lately")).toHaveCount(1);
    await expect(card(page, "Nobody touched it")).toHaveCount(0);

    /* The menu offers the four operators, and the windows that look back. */
    await page.getByTestId("filter-button").click();
    const search = page.getByTestId("filter-search");
    await search.fill("Created");
    await search.press("Enter");
    await expect(page.getByRole("button", { name: "is within" })).toBeVisible();
    await expect(page.getByRole("button", { name: "is empty" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "is not empty" })).toHaveCount(0);
    await page.getByRole("button", { name: "is within" }).click();
    const menu = page.getByTestId("filter-menu");
    await expect(menu.getByRole("option", { name: "The last 30 days" })).toBeVisible();
    await expect(menu.getByRole("option", { name: "Tomorrow" })).toHaveCount(0);
    await expect(menu.getByRole("option", { name: "Overdue" })).toHaveCount(0);

    expect(noise).toEqual([]);
  });
});

test("sorting by Updated, newest first, puts the task just changed first", async ({ page }) => {
  await register(page);
  const projectId = await createProject(page, unique("Newest"));
  const first = await makeTask(page, projectId, "Not changed for days");
  const second = await makeTask(page, projectId, "Changed yesterday");
  const third = await makeTask(page, projectId, "Changed last week");
  await stamp(first, new Date(Date.now() - 9 * DAYS).toISOString());
  await stamp(second, new Date(Date.now() - 1 * DAYS).toISOString());
  await stamp(third, new Date(Date.now() - 7 * DAYS).toISOString());

  const changed = await page.request.patch(`/api/tasks/${first}`, {
    data: { title: "Changed just now" },
  });
  expect(changed.ok()).toBeTruthy();

  await turnOn(page, projectId, "Updated");
  await page.goto(`/p/${projectId}`);
  await addListView(page, "By change");

  await settles(page, /\/api\/views\//, () => listHead(page, "Updated").click());
  await expect
    .poll(() => listOrder(page))
    .toEqual(["Changed last week", "Changed yesterday", "Changed just now"]);
  await settles(page, /\/api\/views\//, () => listHead(page, "Updated").click());
  await expect
    .poll(() => listOrder(page))
    .toEqual(["Changed just now", "Changed yesterday", "Changed last week"]);
  await expect(listHead(page, "Updated")).toHaveAttribute("aria-label", /newest first/);
});
