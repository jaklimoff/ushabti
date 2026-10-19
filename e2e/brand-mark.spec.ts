import { expect, test, type Page } from "@playwright/test";
import { register } from "./helpers";

/*
 * The bar, the sign-in pages and the status pages draw the U of the browser
 * tab: a stroke in a teal square, never a typed letter.
 */

const ICON_U = "M11.6 8.7v7.6a4.4 4.4 0 0 0 8.8 0V8.7";

const strokeU = (page: Page) =>
  page.locator("svg[data-brand-mark]").first().locator(`path[d="${ICON_U}"]`);

test.describe("The brand mark", () => {
  test("is the stroke U on a sign-in page", async ({ page }, testInfo) => {
    await page.goto("/login");
    await expect(strokeU(page)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-login.png") });
  });

  test("is the stroke U on a status page", async ({ page }, testInfo) => {
    await page.goto("/no-such-page-anywhere");
    await expect(strokeU(page)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-not-found.png") });
  });

  test("is the stroke U in the top bar", async ({ page }, testInfo) => {
    await register(page);
    await expect(strokeU(page)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-top-bar.png") });
  });
});
