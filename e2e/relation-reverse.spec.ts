import { expect, test, type Page } from "@playwright/test";
import { card, createProject, gotoSettings, propertyBox, register, unique } from "./helpers";

/*
 * The other side of a Tasks property, in the panel of the task a value names.
 * What the server answers — archived, deleted, the write that takes one off —
 * is `relation-reverse.test.ts`; this is the screen, in two tabs.
 */

type Made = { id: string; key: string };

async function make(page: Page, projectId: string, title: string): Promise<Made> {
  const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title, values: {} },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).task as Made;
}

async function relation(page: Page, projectId: string, name: string): Promise<string> {
  const res = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name, type: "relation" },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).property.id as string;
}

async function point(page: Page, from: Made, propertyId: string, to: Made[]) {
  const res = await page.request.put(`/api/tasks/${from.id}/values/${propertyId}`, {
    data: { value: to.map((t) => t.id) },
  });
  expect(res.ok()).toBeTruthy();
}

test("a task lists what points at it, under the reverse name, live from another tab", async ({
  page,
}, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Reverse"));
  const dupes = await relation(page, projectId, "Duplicate of");
  const relates = await relation(page, projectId, "Relates to");

  // The reverse name is set beside the name, and saves on blur.
  await gotoSettings(page, projectId);
  const box = propertyBox(page, "Duplicate of").getByLabel("Reverse name of Duplicate of");
  await expect(box).toHaveAttribute("placeholder", "Duplicate of");
  await box.fill("Duplicated by");
  const saved = page.waitForResponse(
    (r) => r.url().endsWith(`/api/properties/${dupes}`) && r.request().method() === "PATCH",
  );
  await box.press("Tab");
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(
    propertyBox(page, "Duplicate of").getByLabel("Reverse name of Duplicate of"),
  ).toHaveValue("Duplicated by");

  const original = await make(page, projectId, "Login breaks on Safari");
  const twin = await make(page, projectId, "Safari login fails");
  const old = await make(page, projectId, "Safari sign in, the old report");
  const near = await make(page, projectId, "Sign in is slow");
  const late = await make(page, projectId, "Login fails on iPad");
  await point(page, twin, dupes, [original]);
  await point(page, old, dupes, [original]);
  await point(page, near, relates, [original]);
  expect((await page.request.post(`/api/tasks/${old.id}/archive`)).ok()).toBeTruthy();

  await page.goto(`/p/${projectId}`);
  await card(page, "Login breaks on Safari").click();
  await expect(page.getByTestId("task-title")).toHaveValue("Login breaks on Safari");

  const side = (name: string) => page.getByRole("group", { name, exact: true });
  const keys = (name: string) => side(name).getByTestId("link-row").locator(".mono");

  // Under the reverse name, an archived one says so.
  await expect(keys("Duplicated by")).toHaveText([twin.key, old.key]);
  await expect(side("Duplicated by").getByTestId("link-row").nth(1)).toContainText("archived");
  await expect(side("Duplicated by").getByTestId("link-row").first()).not.toContainText("archived");
  // With no reverse name, the other side reads under the property's own.
  await expect(keys("Relates to")).toHaveText([near.key]);

  // The cards say nothing of it.
  await expect(card(page, "Login breaks on Safari")).not.toContainText(twin.key);

  // Another tab adds a link through the field; this panel shows it unasked.
  const other = await page.context().newPage();
  await other.goto(`/p/${projectId}`);
  await card(other, "Login fails on iPad").click();
  await expect(other.getByTestId("task-title")).toHaveValue("Login fails on iPad");
  await other.getByRole("button", { name: "+ duplicate of" }).click();
  await other.getByTestId("relation-search").fill(original.key);
  await other.getByTestId("relation-search").press("Enter");
  await expect(other.getByTestId("relation-chip")).toHaveText([`${original.key}✕`]);

  await expect(keys("Duplicated by")).toHaveText([twin.key, old.key, late.key]);
  await page.screenshot({ path: testInfo.outputPath("seen-relation-reverse.png") });

  // Taken off here, it comes off the other task's value, and that tab follows.
  await side("Duplicated by").getByTestId("link-row").filter({ hasText: late.key }).hover();
  await side("Duplicated by")
    .getByRole("button", { name: `Unlink ${late.key}` })
    .click();
  await expect(keys("Duplicated by")).toHaveText([twin.key, old.key]);
  await expect(other.getByTestId("relation-chip")).toHaveCount(0);

  // A key opens the task that points.
  await side("Duplicated by")
    .getByRole("button", { name: `Open ${twin.key} Safari login fails` })
    .click();
  await expect(page.getByTestId("task-title")).toHaveValue("Safari login fails");
  await other.close();
});
