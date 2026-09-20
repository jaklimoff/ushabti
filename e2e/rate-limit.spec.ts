import { expect, test } from "@playwright/test";
import { settles, unique } from "./helpers";

test.describe("A guessing attack", () => {
  test("is refused after ten wrong passwords, and the form says how long to wait", async ({
    browser,
  }) => {
    /* The limiter counts per address, and the address is whatever the proxy in
       front says in `x-forwarded-for`. This test spends a whole budget, so it
       takes an address of its own, made fresh inside the test so that a retry
       gets another one. Every other test signs in from 127.0.0.1, and those
       sign-ins succeed — only failures are counted, so the suite never meets
       the limit, and nothing here reaches it either. */
    const address = unique("198.51.100");
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": address },
    });
    const page = await context.newPage();

    /* An email nobody registered. It fails the same way a real one does, and
       it means this test cannot lock another test's account out. */
    const email = `${unique("guess")}@example.com`;

    try {
      await page.goto("/login");
      await page.getByPlaceholder("you@example.com").fill(email);
      const password = page.getByPlaceholder("Your password");
      const signIn = page.getByRole("button", { name: "Sign in" });

      /* The message is found by its words and not by its role: Next's own
         route announcer is an empty `role="alert"` on every page. */
      const wrong = page.getByText("Wrong email or password.");
      const tooMany = page.getByText("Too many tries. Wait 10 minutes and try again.");

      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await password.fill(`guess-${attempt}`);
        await settles(page, /\/api\/auth\/login$/, () => signIn.click());
        await expect(wrong).toBeVisible();
      }

      // The eleventh never reaches the password.
      await password.fill("guess-11");
      const [refused] = await Promise.all([
        page.waitForResponse(
          (r) => new URL(r.url()).pathname === "/api/auth/login" && r.request().method() === "POST",
        ),
        signIn.click(),
      ]);

      expect(refused.status()).toBe(429);
      // Whole seconds, and what is left of the ten minutes.
      const retryAfter = Number(refused.headers()["retry-after"]);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(600);

      /* The form shows the server's sentence where it shows any other error.
         Ten minutes and not nine: the ten tries above take seconds, and the
         sentence rounds what is left of the window up. */
      await expect(tooMany).toBeVisible();
      await expect(wrong).toBeHidden();
    } finally {
      await context.close();
    }
  });
});
