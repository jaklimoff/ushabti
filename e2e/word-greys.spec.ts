import { expect, test, type Locator, type Page } from "@playwright/test";
import { addTask, card, createProject, register, settles, unique } from "./helpers";

/*
 * Words people read are --text-meta or brighter, and a control they have to
 * find is --icon or brighter. These three once sat in the decoration greys.
 */

/** What a custom property paints, in the form getComputedStyle answers. */
async function paint(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

async function colourOf(box: Locator): Promise<string> {
  return box.evaluate((el) => getComputedStyle(el).color);
}

test("the comment box's hint and the selection's clear cross read", async ({ page }, testInfo) => {
  await register(page);
  await createProject(page, unique("Greys"));
  await addTask(page, "Todo", "Grey words");

  const hint = page.locator(".cm-placeholder", { hasText: "Leave a note…" });
  await expect(hint).toBeVisible();
  expect(await colourOf(hint)).toBe(await paint(page, "--text-meta"));
  await page.screenshot({ path: testInfo.outputPath("seen-comment-hint.png") });

  await page.getByRole("button", { name: "Close task" }).click();
  await card(page, "Grey words").getByTestId("card-pick").click();
  const clear = page.getByTestId("pick-clear");
  await expect(clear).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await colourOf(clear)).toBe(await paint(page, "--icon"));
  await page.screenshot({ path: testInfo.outputPath("seen-pick-clear.png") });
});

test("a chart's delete cross can be found", async ({ page }, testInfo) => {
  await register(page);
  const name = unique("Chart greys");
  await createProject(page, name);
  await addTask(page, "Todo", "Counted");

  await page.goto("/projects");
  await page.getByTestId("chart-new").click();
  const picker = page.getByTestId("chart-picker");
  await picker.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name }).click();
  await picker.getByRole("combobox", { name: "Property" }).click();
  await page.getByRole("option", { name: "Status" }).click();
  await picker.getByRole("button", { name: "Todo", exact: true }).click();
  await settles(page, /\/api\/charts$/, () =>
    page.getByRole("button", { name: "Add chart" }).click(),
  );

  const cross = page.getByRole("button", { name: "Delete the chart Entered Todo" });
  await expect(cross).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await colourOf(cross)).toBe(await paint(page, "--icon"));
  await page.screenshot({ path: testInfo.outputPath("seen-chart-delete.png") });
});
