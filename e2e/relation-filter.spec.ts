import { expect, test, type Page } from "@playwright/test";
import { addFilter, card, column, createProject, register, settles, unique } from "./helpers";

/*
 * A board filtered by a Tasks property. What each operator keeps, the chip of
 * a deleted task and the seed are `filters.test.ts`; this is the screen: the
 * search that picks a task, the chip, the composer and a reload.
 */

type Made = { id: string; key: string };

async function make(page: Page, projectId: string, title: string): Promise<Made> {
  const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title, values: {} },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).task as Made;
}

async function point(page: Page, from: Made, propertyId: string, to: Made[]) {
  const res = await page.request.put(`/api/tasks/${from.id}/values/${propertyId}`, {
    data: { value: to.map((t) => t.id) },
  });
  expect(res.ok()).toBeTruthy();
}

function chip(page: Page) {
  return page.getByTestId("filter-chip");
}

test("a board filters by the tasks a property points at", async ({ page }, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Dupes"));
  const res = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Duplicate of", type: "relation" },
  });
  expect(res.ok()).toBeTruthy();
  const dupes = (await res.json()).property.id as string;

  const original = await make(page, projectId, "Login breaks on Safari");
  const twin = await make(page, projectId, "Safari login fails");
  const other = await make(page, projectId, "Export is slow");
  const copy = await make(page, projectId, "Export takes ages");
  await make(page, projectId, "Plain task");
  await point(page, twin, dupes, [original]);
  await point(page, copy, dupes, [other]);

  await page.goto(`/p/${projectId}`);
  const titles = ["Login breaks on Safari", "Safari login fails", "Export is slow"];
  for (const title of titles) await expect(card(page, title)).toBeVisible();

  // "is": picked from the search by key, named by key on the chip.
  await addFilter(page, "Duplicate of", original.key);
  await expect(chip(page)).toHaveText(`Duplicate of is ${original.key}`);
  await expect(card(page, "Safari login fails")).toBeVisible();
  await expect(card(page, "Login breaks on Safari")).toHaveCount(0);
  await expect(card(page, "Export takes ages")).toHaveCount(0);
  await expect(card(page, "Plain task")).toHaveCount(0);

  // A task added under it points at the picked task, and the composer says so first.
  await page.getByRole("button", { name: "Add a task to Backlog" }).first().click();
  await expect(column(page, "Backlog")).toContainText(`sets Duplicate of ${original.key}`);
  const input = page.getByPlaceholder("What needs doing?");
  await input.fill("Safari login, again");
  await input.press("Enter");
  await expect(card(page, "Safari login, again")).toBeVisible();
  await page.keyboard.press("Escape");
  await card(page, "Safari login, again").click();
  await expect(page.getByTestId("relation-chip")).toHaveText([`${original.key}✕`]);
  await page.getByRole("button", { name: "Close task" }).click();

  // "is not" keeps the tasks that point at nothing.
  await chip(page).click();
  await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
    page.getByRole("button", { name: "is not", exact: true }).click(),
  );
  await page.keyboard.press("Escape");
  await expect(chip(page)).toHaveText(`Duplicate of is not ${original.key}`);
  await expect(card(page, "Plain task")).toBeVisible();
  await expect(card(page, "Login breaks on Safari")).toBeVisible();
  await expect(card(page, "Export takes ages")).toBeVisible();
  await expect(card(page, "Safari login fails")).toHaveCount(0);
  await expect(card(page, "Safari login, again")).toHaveCount(0);

  // "is empty" hides every duplicate.
  await chip(page).click();
  await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
    page.getByRole("button", { name: "is empty", exact: true }).click(),
  );
  await page.keyboard.press("Escape");
  await expect(chip(page)).toHaveText("Duplicate of is empty");
  await expect(card(page, "Plain task")).toBeVisible();
  await expect(card(page, "Export is slow")).toBeVisible();
  await expect(card(page, "Safari login fails")).toHaveCount(0);
  await expect(card(page, "Export takes ages")).toHaveCount(0);

  // "is not empty" keeps only them.
  await chip(page).click();
  await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
    page.getByRole("button", { name: "is not empty", exact: true }).click(),
  );
  await page.keyboard.press("Escape");
  await expect(card(page, "Safari login fails")).toBeVisible();
  await expect(card(page, "Export takes ages")).toBeVisible();
  await expect(card(page, "Plain task")).toHaveCount(0);

  // A rule naming a task deleted since reads so, and goes on working.
  await settles(page, /\/api\/views\/[0-9a-f-]+\/lens$/, () =>
    page.getByRole("button", { name: "Remove the filter Duplicate of is not empty" }).click(),
  );
  await expect(chip(page)).toHaveCount(0);
  await addFilter(page, "Duplicate of", other.key);
  await expect(card(page, "Export takes ages")).toBeVisible();
  expect((await page.request.delete(`/api/tasks/${other.id}`)).ok()).toBeTruthy();
  await page.reload();
  await expect(chip(page)).toHaveText("Duplicate of is a deleted task");
  await expect(card(page, "Export takes ages")).toBeVisible();
  await expect(card(page, "Plain task")).toHaveCount(0);
  await card(page, "Export takes ages").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("seen-relation-filter.png") });

  // The rule's own panel: the deleted task stays ticked, and the search finds more.
  await chip(page).click();
  await page.getByTestId("filter-box").fill("Safari");
  await expect(page.getByRole("option", { name: /Safari login fails/ })).toBeVisible();
  await expect(page.getByRole("option", { name: "a deleted task" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("seen-relation-filter-picker.png") });
});
