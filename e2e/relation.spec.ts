import { expect, test, type Page } from "@playwright/test";
import { card, createProject, gotoSettings, propertyBox, register, unique } from "./helpers";

/*
 * A property of type Tasks, picked by search in the panel. The guards of the
 * write and the read after a delete are `relation-route.test.ts`; this is the
 * screen.
 */

type Made = { id: string; key: string };

async function make(page: Page, projectId: string, title: string): Promise<Made> {
  const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title, values: {} },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).task as Made;
}

test("a Tasks property is picked by search and opens the task it names", async ({
  page,
}, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Dupes"));

  await gotoSettings(page, projectId);
  await page.getByLabel("New property name").fill("Duplicate of");
  await page.getByLabel("Type of the new property").click();
  await page.getByRole("option", { name: "Tasks", exact: true }).click();
  await expect(page.getByText("Other tasks of this project, such as a duplicate.")).toBeVisible();
  await page.getByRole("button", { name: "Add property" }).click();
  await expect(
    propertyBox(page, "Duplicate of").getByLabel("Name of the Duplicate of property"),
  ).toHaveValue("Duplicate of");

  const here = await make(page, projectId, "Login breaks on Safari");
  const twin = await make(page, projectId, "Safari login fails");
  const old = await make(page, projectId, "Safari sign in, the old report");
  expect((await page.request.post(`/api/tasks/${old.id}/archive`)).ok()).toBeTruthy();

  await page.goto(`/p/${projectId}`);
  await card(page, "Login breaks on Safari").click();
  await expect(page.getByTestId("task-title")).toHaveValue("Login breaks on Safari");

  const add = page.getByRole("button", { name: "+ duplicate of" });
  const search = page.getByTestId("relation-search");
  const offered = page.getByRole("listbox", { name: "Duplicate of" }).getByRole("option");

  // Words of a title find live and archived tasks, and never this one.
  await add.click();
  await search.fill("safari");
  await expect(offered).toHaveCount(2);
  await expect(offered.filter({ hasText: twin.key })).toHaveCount(1);
  await expect(offered.filter({ hasText: old.key })).toContainText("archived");
  await expect(offered.filter({ hasText: here.key })).toHaveCount(0);

  // A key finds its task.
  await search.fill(twin.key);
  await expect(offered.first()).toContainText("Safari login fails");
  await search.press("Enter");
  const chips = page.getByTestId("relation-chip");
  await expect(chips).toHaveText([`${twin.key}✕`]);

  // What is picked is not offered again.
  await add.click();
  await search.fill("safari");
  await expect(offered).toHaveCount(1);
  await expect(offered.first()).toContainText(old.key);
  await page.screenshot({ path: testInfo.outputPath("seen-relation-search.png") });
  await offered.first().click();
  await expect(chips).toHaveText([`${twin.key}✕`, `${old.key}✕`]);

  // The card says nothing yet, and never an id.
  const onCard = card(page, "Login breaks on Safari");
  await expect(onCard).not.toContainText(twin.id);
  await expect(onCard).not.toContainText(twin.key);

  // A key opens its task.
  await chips
    .first()
    .getByRole("button", { name: `Open ${twin.key} Safari login fails` })
    .click();
  await expect(page.getByTestId("task-title")).toHaveValue("Safari login fails");

  // A deleted task drops out of the field, and comes back when restored.
  expect((await page.request.delete(`/api/tasks/${twin.id}`)).ok()).toBeTruthy();
  await page.goto(`/p/${projectId}`);
  await card(page, "Login breaks on Safari").click();
  await expect(chips).toHaveText([`${old.key}✕`]);
  expect((await page.request.post(`/api/tasks/${twin.id}/restore`)).ok()).toBeTruthy();
  await page.reload();
  await card(page, "Login breaks on Safari").click();
  await expect(chips).toHaveText([`${twin.key}✕`, `${old.key}✕`]);
  await page.screenshot({ path: testInfo.outputPath("seen-relation-field.png") });
});
