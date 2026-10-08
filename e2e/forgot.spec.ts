import { expect, test, type Browser, type Page } from "@playwright/test";
import { letterTo, register, unique, type Account } from "./helpers";
import { smtpReceiver } from "../src/lib/__tests__/smtp";

/**
 * "Forgot password?" on the sign-in page.
 *
 * It needs mail and USHABTI_URL, both of which are the server's environment.
 * The server Playwright starts has both (see `playwright.config.ts`); the dev
 * server in Docker has neither, and there the link must not be drawn at all.
 */
const smtpPort = Number(process.env.USHABTI_TEST_SMTP_PORT) || 0;

const SENT = "If an account uses that email, a link is on its way. It works once, for 24 hours.";

/** An account that can sign in, made in a browser of its own and left. */
async function account(browser: Browser, name: string): Promise<Account> {
  const context = await browser.newContext();
  const made = await register(await context.newPage(), name);
  await context.close();
  return made;
}

/** Asks for a link from the sign-in page, the way a person would get there. */
async function askFor(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.waitForURL("**/forgot");
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toHaveText(SENT);
}

if (smtpPort) forgotOn();
else forgotOff();

function forgotOn() {
  test.describe("Forgot password, with mail and USHABTI_URL", () => {
    /* A request is counted against the calling address. An address of its
       own per test, fresh on every run and retry, keeps the count its own. */
    test.beforeEach(async ({ page }) => {
      await page.setExtraHTTPHeaders({ "x-forwarded-for": unique("198.51.100") });
    });

    test("the emailed link sets a new password, and an unknown email sends nothing", async ({
      page,
      browser,
      baseURL,
    }) => {
      const mail = await smtpReceiver(smtpPort);
      try {
        const ada = await account(browser, "Ada Lovelace");

        // An unknown email reads exactly the same, and nothing is sent.
        const nobody = `${unique("nobody")}@example.com`;
        await askFor(page, nobody);

        await askFor(page, ada.email.toUpperCase());
        const letter = await letterTo(mail, ada.email);
        expect(letter.to).toEqual([ada.email]);
        expect(letter.text).toContain("Hello Ada Lovelace,");
        expect(letter.text).toContain("It works once, for 24 hours.");
        expect(letter.text).toContain("If you did not ask for this, do nothing.");
        const link = /(https?:\/\/\S+\/reset\/ushr_\S+)/.exec(letter.text)?.[1];
        expect(link?.startsWith(`${baseURL}/reset/`)).toBe(true);

        const theirs = await browser.newContext();
        const them = await theirs.newPage();
        await them.goto(link!);
        await them.getByLabel("Your new password").fill("a-forgotten-secret");
        await them.getByRole("button", { name: "Set the password" }).click();
        await them.waitForURL("**/projects");
        await theirs.close();

        // The old password is gone and the new one signs in.
        const again = await browser.newContext();
        const back = await again.newPage();
        await back.goto("/login");
        await back.getByPlaceholder("you@example.com").fill(ada.email);
        await back.getByPlaceholder("Your password").fill(ada.password);
        await back.getByRole("button", { name: "Sign in" }).click();
        await expect(back.getByText("Wrong email or password.")).toBeVisible();
        await back.getByPlaceholder("Your password").fill("a-forgotten-secret");
        await back.getByRole("button", { name: "Sign in" }).click();
        await back.waitForURL("**/projects");
        await again.close();

        /* Other files send to this port too, so only the two addresses asked
           for here are counted: one letter to Ada, and none to nobody. */
        expect(mail.letters.filter((l) => l.to.includes(ada.email))).toHaveLength(1);
        expect(mail.letters.filter((l) => l.to.includes(nobody))).toEqual([]);
      } finally {
        await mail.stop();
      }
    });
  });
}

function forgotOff() {
  test.describe("Forgot password, without mail", () => {
    test("the sign-in page has no link, and /forgot says to ask an admin", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveCount(0);

      await page.goto("/forgot");
      await expect(
        page.getByText(
          "This board cannot email you a link. Ask an admin of your project to make you one.",
        ),
      ).toBeVisible();
      await expect(page.getByLabel("Your email")).toHaveCount(0);

      await page.goto("/register");
      await expect(page.getByText(/the owner of a project you are in has to make/)).toBeVisible();
    });
  });
}
