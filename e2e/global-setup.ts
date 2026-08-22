import { chromium } from "@playwright/test";

/**
 * `next dev` compiles a route the first time something asks for it, which can
 * take several seconds and looks exactly like a slow test. This walks the whole
 * app once so every route is warm before the first spec runs.
 */
export default async function globalSetup() {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    const email = `warmup-${Date.now().toString(36)}@example.com`;
    await page.goto(`${baseURL}/register`, { timeout: 90_000 });
    await page.getByPlaceholder("Ada Lovelace").fill("Warm Up");
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByPlaceholder("At least 8 characters").fill("ushabti-secret");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/projects", { timeout: 90_000 });

    await page.getByPlaceholder("Project name").fill("Warm up");
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/p\/[0-9a-f-]{36}/, { timeout: 90_000 });
    const projectId = page.url().split("/p/")[1].split("?")[0];

    // a task, its panel and the settings page, so those routes compile too
    await page
      .getByRole("button", { name: /^Add a task to Todo$/ })
      .first()
      .click();
    const composer = page.getByPlaceholder("What needs doing?");
    await composer.fill("Warm up");
    await composer.press("Enter");
    await page.getByRole("button", { name: "Close task" }).click({ timeout: 60_000 });
    await page.goto(`${baseURL}/p/${projectId}/settings`, { timeout: 90_000 });
    await page.getByLabel("New property name").waitFor({ timeout: 60_000 });
    await page.goto(`${baseURL}/login`);
  } finally {
    await browser.close();
  }
}
