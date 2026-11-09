import { expect, test, type Page } from "@playwright/test";
import { addListView, card, createProject, listRow, register, settles, unique } from "./helpers";

/*
 * A Tasks property on a card, in a list and in Set…. The words a chip and a
 * cell draw are `card-view.test.ts`; this is the screen.
 */

type Made = { id: string; key: string };

const BULK = /\/api\/projects\/[0-9a-f-]+\/tasks\/values$/;

async function make(page: Page, projectId: string, title: string): Promise<Made> {
  const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title, values: {} },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).task as Made;
}

async function setValue(page: Page, taskId: string, propertyId: string, value: string[]) {
  const res = await page.request.put(`/api/tasks/${taskId}/values/${propertyId}`, {
    data: { value },
  });
  expect(res.ok()).toBeTruthy();
}

/** A project with a Duplicate of property in the card's footer. */
async function project(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Dupes"));
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Duplicate of", type: "relation" },
  });
  expect(made.ok()).toBeTruthy();
  const dup = (await made.json()).property as { id: string };
  const put = await page.request.patch(`/api/projects/${projectId}/card-view`, {
    data: { cardView: { rows: { [dup.id]: { place: "footerR", mode: "boxed" } } } },
  });
  expect(put.ok()).toBeTruthy();
  return { projectId, dup: dup.id };
}

test("a card shows the first key and +N, and a list shows every key", async ({
  page,
}, testInfo) => {
  const { projectId, dup } = await project(page);
  const here = await make(page, projectId, "Login breaks on Safari");
  const twin = await make(page, projectId, "Safari login fails");
  const old = await make(page, projectId, "Safari sign in, the old report");
  const gone = await make(page, projectId, "Safari, a mistake");
  await setValue(page, here.id, dup, [twin.id, old.id, gone.id]);
  expect((await page.request.post(`/api/tasks/${old.id}/archive`)).ok()).toBeTruthy();
  expect((await page.request.delete(`/api/tasks/${gone.id}`)).ok()).toBeTruthy();

  await page.goto(`/p/${projectId}`);
  const chip = card(page, "Login breaks on Safari").locator(
    `[data-testid="card-chip"][data-item="${dup}"]`,
  );
  // The deleted task is left out; the archived one is still named.
  await expect(chip).toHaveText(`${twin.key} +1`);
  await expect(chip).toHaveAttribute("data-tip", `Duplicate of · ${twin.key}, ${old.key}`);
  await expect(card(page, "Login breaks on Safari")).not.toContainText(gone.key);
  await page.screenshot({ path: testInfo.outputPath("seen-relation-card.png") });

  // A click on the chip opens the card's own task, not the one it names.
  await chip.click();
  await expect(page.getByTestId("task-title")).toHaveValue("Login breaks on Safari");
  await page.getByRole("button", { name: "Close task" }).click();

  await addListView(page, "All");
  const cell = listRow(page, "Login breaks on Safari")
    .getByTestId("list-cell")
    .locator(`[data-testid="card-chip"][data-item="${dup}"]`);
  await expect(cell).toHaveText(`${twin.key}, ${old.key}`);
  await page.screenshot({ path: testInfo.outputPath("seen-relation-list.png") });
});

test("Set… puts a Tasks value on every picked card, and clears it", async ({ page }, testInfo) => {
  const { projectId, dup } = await project(page);
  const twin = await make(page, projectId, "The one to point at");
  await make(page, projectId, "Aardvark");
  await make(page, projectId, "Beetle");

  await page.goto(`/p/${projectId}`);
  for (const title of ["Aardvark", "Beetle"]) {
    await card(page, title).getByTestId("card-pick").click();
  }
  await page.getByTestId("pick-set").click();
  const search = page.getByTestId("pick-search");
  await search.fill("Duplicate");
  await search.press("Enter");

  const menu = page.getByTestId("pick-menu");
  await menu.getByRole("button", { name: "+ duplicate of" }).click();
  const find = page.getByTestId("relation-search");
  const offered = page.getByRole("listbox", { name: "Tasks" }).getByRole("option");
  // A picked card is never offered: it cannot point at itself.
  await find.fill("a");
  await expect(offered.filter({ hasText: "Aardvark" })).toHaveCount(0);
  await find.fill(twin.key);
  await expect(offered.first()).toContainText("The one to point at");
  await settles(page, BULK, () => find.press("Enter"));

  const chipOf = (title: string) =>
    card(page, title).locator(`[data-testid="card-chip"][data-item="${dup}"]`);
  await expect(chipOf("Aardvark")).toHaveText(twin.key);
  await expect(chipOf("Beetle")).toHaveText(twin.key);
  await page.screenshot({ path: testInfo.outputPath("seen-relation-set.png") });

  await settles(page, BULK, () => menu.getByTestId("pick-clear-value").click());
  await expect(chipOf("Aardvark")).toHaveCount(0);
  await expect(chipOf("Beetle")).toHaveCount(0);

  await page.reload();
  await expect(card(page, "Aardvark")).toBeVisible();
  await expect(chipOf("Aardvark")).toHaveCount(0);
  await expect(chipOf("Beetle")).toHaveCount(0);
});
