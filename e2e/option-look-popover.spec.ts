import { expect, test, type Locator, type Page } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

/*
 * The colour and icon popover of an option hangs below its chip. On the last
 * property that is past the bottom of the Properties card, which used to cut
 * the icon grid off after its first row.
 */

async function lastPropertyWithOptions(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Popover"));
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Repos", type: "select", options: ["web", "api"] },
  });
  expect(made.status()).toBe(201);
  await page.goto(`/p/${projectId}/settings/properties`);
  const last = page.getByTestId("property-box").last();
  await expect(last.getByRole("button", { name: "Colour of api" })).toBeVisible();
}

/** Whether the point in the middle of this element hits it, and is not clipped away. */
async function hits(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return at !== null && (at === el || el.contains(at));
  });
}

test.describe("The option popover in Properties", () => {
  test("shows whole on the last property, and the card keeps its corners", async ({
    page,
  }, testInfo) => {
    await lastPropertyWithOptions(page);
    const box = page.getByTestId("property-box").last();
    const propCard = box.locator("xpath=..");

    // No popover open: the card is still rounded, and so is its filled foot.
    const radius = await propCard.evaluate((el) => getComputedStyle(el).borderBottomLeftRadius);
    expect(parseFloat(radius)).toBeGreaterThan(0);
    const foot = propCard.locator(":scope > :last-child");
    const footRadius = await foot.evaluate((el) => getComputedStyle(el).borderBottomRightRadius);
    expect(parseFloat(footRadius)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("seen-properties-closed.png") });

    await box.getByRole("button", { name: "Colour of api" }).click();
    const pop = page.getByRole("dialog", { name: "Colour and icon of api" });
    await expect(pop).toBeVisible();

    // It reaches past the card, and nothing of it is cut off.
    const popAt = (await pop.boundingBox())!;
    const cardAt = (await propCard.boundingBox())!;
    expect(popAt.y + popAt.height).toBeGreaterThan(cardAt.y + cardAt.height);
    const search = pop.getByRole("searchbox", { name: "Search icons for api" });
    expect(await hits(search)).toBe(true);
    const icons = pop.getByRole("listbox", { name: "Icon of api" }).getByRole("option");
    expect(await icons.count()).toBeGreaterThan(8);
    expect(await hits(icons.last())).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("seen-properties-popover.png") });

    // The last icon can be picked.
    const picked = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && r.url().includes("/options/"),
    );
    await icons.last().click();
    expect((await picked).ok()).toBe(true);
  });

  test("on a phone it sits at the foot of the screen", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await lastPropertyWithOptions(page);
    const box = page.getByTestId("property-box").last();
    await box.getByRole("button", { name: "Colour of api" }).click();
    const pop = page.getByRole("dialog", { name: "Colour and icon of api" });
    await expect(pop).toBeVisible();
    const at = (await pop.boundingBox())!;
    expect(at.x).toBe(8);
    expect(at.x + at.width).toBe(375 - 8);
    expect(Math.round(at.y + at.height)).toBe(740 - 8);
    expect(
      await hits(pop.getByRole("listbox", { name: "Icon of api" }).getByRole("option").last()),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("seen-properties-popover-phone.png") });
  });
});
