import { expect, test, type Locator } from "@playwright/test";
import { createProject, gotoSettings, register, signIn, unique } from "./helpers";

/**
 * A password manager that writes straight onto the box, with no event React
 * hears. The value is then in the page and nowhere else, and the next render
 * of a controlled box wrote React's own empty copy back over it.
 */
async function fillWithNoEvent(box: Locator, value: string) {
  await box.evaluate((el: HTMLInputElement, v: string) => {
    el.value = v;
  }, value);
}

/**
 * A fill before React has taken the page over is a different question, so
 * every test waits for the box to belong to React first.
 */
async function hydrated(box: Locator) {
  await expect
    .poll(() => box.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))))
    .toBe(true);
}

test.describe("A password filled with no event", () => {
  test("survives typing in the email box on the sign-in page, and signs in", async ({
    page,
    browser,
  }) => {
    const theirs = await browser.newContext();
    const account = await register(await theirs.newPage(), "Ada Lovelace");
    await theirs.close();

    await page.goto("/login");
    const email = page.getByLabel("Your email");
    const password = page.getByLabel("Your password");
    await hydrated(password);

    await email.fill(account.email.slice(0, -1));
    await fillWithNoEvent(password, account.password);
    await email.pressSequentially(account.email.slice(-1));
    await expect(email).toHaveValue(account.email);
    await expect(password).toHaveValue(account.password);

    const sent = page.waitForRequest("**/api/auth/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    expect((await sent).postDataJSON()).toMatchObject({
      email: account.email,
      password: account.password,
    });
    await page.waitForURL("**/projects");
  });

  test("survives the eye on the reset page, and sets the password", async ({ page, browser }) => {
    const theirs = await browser.newContext();
    const them = await theirs.newPage();
    const member = await register(them, "Ada Lovelace");

    await register(page, "Owner Person");
    const projectId = await createProject(page, unique("Fill"));
    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Email of the new member").fill(member.email);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await page.getByRole("button", { name: "Reset password" }).click();
    await page.getByRole("button", { name: "Yes, make a link" }).click();
    const link = (await page.getByTestId("reset-link").locator("code").innerText()).trim();

    await them.goto(link);
    const box = them.getByLabel("Your new password");
    await hydrated(box);
    await fillWithNoEvent(box, "a-filled-secret");

    await them.getByRole("button", { name: "Show the password" }).click();
    await expect(box).toHaveAttribute("type", "text");
    await expect(box).toHaveValue("a-filled-secret");
    await them.getByRole("button", { name: "Hide the password" }).click();
    await expect(box).toHaveAttribute("type", "password");
    await expect(box).toHaveValue("a-filled-secret");

    await them.getByRole("button", { name: "Set the password" }).click();
    await them.waitForURL("**/projects");
    await theirs.close();

    const again = await browser.newContext();
    await signIn(await again.newPage(), { ...member, password: "a-filled-secret" });
    await again.close();
  });

  test("survives typing in the other box on the account page, both ways", async ({
    page,
    browser,
  }) => {
    const account = await register(page, "Ada Lovelace");
    await page.goto("/account");
    const now = page.getByLabel("The password you use now");
    const want = page.getByLabel("The password you want");
    const change = page.getByRole("button", { name: "Change password" });
    await hydrated(now);

    // The button cannot tell an empty box from a filled one, so it says it.
    await change.click();
    await expect(page.getByText("Type the password you use now.")).toBeVisible();
    await expect(now).toHaveAttribute("aria-invalid", "true");

    await fillWithNoEvent(now, account.password);
    await want.fill("a-second-secret");
    await expect(now).toHaveValue(account.password);
    await change.click();
    await expect(page.getByTestId("toast")).toContainText("Password changed.");
    await expect(now).toHaveValue("");
    await expect(want).toHaveValue("");

    await fillWithNoEvent(want, "a-third-secret");
    await now.fill("a-second-secret");
    await expect(want).toHaveValue("a-third-secret");
    await change.click();
    await expect(page.getByTestId("toast").last()).toContainText("Password changed.");
    await expect(want).toHaveValue("");

    const again = await browser.newContext();
    await signIn(await again.newPage(), { ...account, password: "a-third-secret" });
    await again.close();
  });
});
