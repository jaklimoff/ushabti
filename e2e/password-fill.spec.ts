import { expect, test, type Locator } from "@playwright/test";
import { hydrated, register } from "./helpers";

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

/* The reset page and the account page fill a box the same way, and are
   `AuthForms.test.tsx` and `Account.test.tsx`. */
test.describe("A password filled with no event", () => {
  test(
    "survives typing in the email box on the sign-in page, and signs in",
    { tag: "@smoke" },
    async ({ page, browser }) => {
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
    },
  );
});
