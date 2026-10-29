import { expect, test, type Page } from "@playwright/test";
import { card, createProject, register, unique } from "./helpers";

/*
 * The thin bar beside a card's checklist count. A fill inside a span used to
 * be inline, so its width did nothing and the bar read as empty at any count.
 */
async function aTaskWithFour(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Progress"));
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title: "Four things" },
  });
  expect(made.status()).toBe(201);
  const { task } = (await made.json()) as { task: { id: string } };
  const items: string[] = [];
  for (const text of ["One", "Two", "Three", "Four"]) {
    const r = await page.request.post(`/api/tasks/${task.id}/checklist`, { data: { text } });
    items.push(((await r.json()) as { item: { id: string } }).item.id);
  }
  return items;
}

async function share(page: Page) {
  const bar = card(page, "Four things").first().locator("[class*='cardProgressBar']");
  const fill = bar.locator("[class*='meterFill']");
  // the fill eases to its width, so read it once it has settled
  await page.waitForTimeout(300);
  const track = (await bar.boundingBox())!.width;
  const filled = (await fill.boundingBox())?.width ?? 0;
  return filled / track;
}

test("the checklist bar fills with the share of items ticked", async ({ page }, testInfo) => {
  const items = await aTaskWithFour(page);
  const tick = async (id: string) =>
    expect((await page.request.patch(`/api/checklist/${id}`, { data: { done: true } })).ok()).toBe(
      true,
    );

  await page.reload();
  await expect(card(page, "Four things").first()).toContainText("0/4");
  expect(await share(page)).toBeCloseTo(0, 2);

  await tick(items[0]);
  await tick(items[1]);
  await page.reload();
  await expect(card(page, "Four things").first()).toContainText("2/4");
  expect(await share(page)).toBeCloseTo(0.5, 1);
  await card(page, "Four things")
    .first()
    .screenshot({ path: testInfo.outputPath("seen-card-progress-half.png") });

  await tick(items[2]);
  await tick(items[3]);
  await page.reload();
  await expect(card(page, "Four things").first()).toContainText("4/4");
  expect(await share(page)).toBeCloseTo(1, 1);
});
