import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

/**
 * The eye beside a password box.
 *
 * Nothing covered it before: the button was reported as doing nothing, and
 * the only way to make it do nothing is to press it before the page is
 * running. So the test waits for the button to answer once, then asks it.
 */
async function pressAndRead(page: Page, field: string) {
  const box = page.getByLabel(field);
  await box.fill("a-long-secret");
  await expect(box).toHaveAttribute("type", "password");

  const show = page.getByRole("button", { name: "Show the password" });
  await expect(show).toHaveAttribute("aria-pressed", "false");
  // A glyph and no word, so the name is all a screen reader has.
  await expect(show).toHaveText("");
  await expect(show.locator("svg")).toBeVisible();

  await show.click();
  await expect(box).toHaveAttribute("type", "text");
  await expect(box).toHaveValue("a-long-secret");

  const hide = page.getByRole("button", { name: "Hide the password" });
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await hide.click();
  await expect(box).toHaveAttribute("type", "password");
  await expect(box).toHaveValue("a-long-secret");
}

test.describe("Showing a password", () => {
  test("the eye shows and hides it on the sign-in page", async ({ page }) => {
    await page.goto("/login");
    await pressAndRead(page, "Your password");

    // It is a button in a form, so it must never send the form.
    await expect(page.getByRole("button", { name: /the password/ })).toHaveAttribute(
      "type",
      "button",
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the eye shows and hides it on the reset page", async ({ page, browser }) => {
    const theirs = await browser.newContext();
    const them = await theirs.newPage();
    const member = await register(them, "Ada Lovelace");

    await register(page, "Owner Person");
    const projectId = await createProject(page, unique("Reveal"));
    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Email of the new member").fill(member.email);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    await page.getByRole("button", { name: "Reset password" }).click();
    await page.getByRole("button", { name: "Yes, make a link" }).click();
    const link = (await page.getByTestId("reset-link").locator("code").innerText()).trim();

    await them.goto(link);
    await pressAndRead(them, "Your new password");

    await theirs.close();
  });
});
