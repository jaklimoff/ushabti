import { expect, test } from "@playwright/test";
import { register } from "./helpers";

/**
 * The pages a signed-out person sees. Each one says what Ushabti is, and the
 * brand stands at the same height on all of them, so moving between them
 * moves only the card. A dead invite or reset token is any token at all.
 */
const WHAT = "A task board where people and AI agents work the same tasks.";

const PAGES = [
  "/login",
  "/register",
  "/forgot",
  "/invite/ushi_nothing-was-ever-made-with-this",
  "/reset/ushr_nothing-was-ever-made-with-this",
];

test.describe("The sign-in pages", () => {
  test("say what Ushabti is, with the brand at one height", async ({ page }, testInfo) => {
    const heights: number[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      const what = page.getByText(WHAT, { exact: true });
      await expect(what).toBeVisible();
      heights.push(Math.round((await what.boundingBox())!.y));
      await page.screenshot({
        path: testInfo.outputPath(`seen-${path.split("/")[1]}.png`),
      });
    }
    expect(new Set(heights).size).toBe(1);
  });

  test("an error grows the card down and leaves the brand where it was", async ({ page }) => {
    await page.goto("/register");
    const what = page.getByText(WHAT, { exact: true });
    const before = (await what.boundingBox())!.y;

    await page.getByLabel("Your password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Type your name.")).toBeVisible();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
    await expect(page.getByLabel("Your name")).toBeFocused();
    await expect(page.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
    expect((await what.boundingBox())!.y).toBe(before);
  });

  test("an empty sign-in names the box and focuses it", async ({ page }, testInfo) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Type your email.")).toBeVisible();
    await expect(page.getByLabel("Your email")).toBeFocused();
    await expect(page.getByLabel("Your email")).toHaveAttribute("aria-invalid", "true");
    await page.screenshot({ path: testInfo.outputPath("seen-login-empty.png") });
  });

  test("an email already in use shows on the email box", async ({ page, browser }) => {
    const other = await browser.newContext();
    const taken = await register(await other.newPage(), "Taken Person");
    await other.close();

    await page.goto("/register");
    await page.getByLabel("Your name").fill("Second Person");
    await page.getByLabel("Your email").fill(taken.email);
    await page.getByLabel("Your password").fill("a-long-enough-secret");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByLabel("Your email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Your email")).toBeFocused();
  });
});
