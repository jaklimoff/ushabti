import { expect, test, type Browser, type Page } from "@playwright/test";
import { createProject, gotoSettings, inDatabase, register, unique } from "./helpers";
import { smtpReceiver } from "../src/lib/__tests__/smtp";

/**
 * The server emails the invite and the reset link.
 *
 * Mail is set by the server's environment, so which half of this file runs
 * depends on the server. Playwright points the server it starts at a port it
 * picked (see `playwright.config.ts`), and the test listens there with a
 * small SMTP receiver; the dev server in Docker has no mail, and there the
 * screens must read exactly as they did before there was any.
 */
const smtpPort = Number(process.env.USHABTI_TEST_SMTP_PORT) || 0;

/** An owner on the People page of a project of their own. */
async function ownerOnPeople(page: Page, prefix: string) {
  await register(page, "Owner Person");
  const projectName = unique(prefix);
  const projectId = await createProject(page, projectName);
  await gotoSettings(page, projectId, "people");
  return { projectId, projectName };
}

/** Adds somebody by email, and answers what the route said. */
async function add(page: Page, email: string): Promise<{ emailed?: boolean }> {
  const answer = page.waitForResponse(
    (res) => res.request().method() === "POST" && /\/members$/.test(new URL(res.url()).pathname),
  );
  await page.getByLabel("Email of the new member").fill(email);
  await page.getByRole("button", { name: "Add member" }).click();
  return (await (await answer).json()) as { emailed?: boolean };
}

/** Makes a reset link on the only row that offers one, and answers the route. */
async function makeLink(page: Page): Promise<{ link: string; emailed?: boolean }> {
  const answer = page.waitForResponse(
    (res) => res.request().method() === "POST" && /\/reset$/.test(new URL(res.url()).pathname),
  );
  await page.getByRole("button", { name: "Reset password" }).click();
  await page.getByRole("button", { name: "Yes, make a link" }).click();
  return (await (await answer).json()) as { link: string; emailed?: boolean };
}

/** A member who can sign in, and whose own browser is left out of it. */
async function member(browser: Browser, name: string) {
  const context = await browser.newContext();
  const account = await register(await context.newPage(), name);
  await context.close();
  return account;
}

/* One half or the other, never both: the server is the one Playwright
   started or the one it reused, and only one of them has mail. */
if (smtpPort) mailOn();
else mailOff();

function mailOn() {
  test.describe("Mail, with SMTP_URL set", () => {
    /* A send spends a try of the calling address, and every other spec on
       CI sends from 127.0.0.1 too. An address of its own per test, made
       fresh on every run and retry, keeps their sends out of this count. */
    test.beforeEach(async ({ page }) => {
      await page.setExtraHTTPHeaders({ "x-forwarded-for": unique("198.51.100") });
    });

    test("an invite to a new email reaches the mail server with the sign-up link", async ({
      page,
      browser,
    }) => {
      const mail = await smtpReceiver(smtpPort);
      try {
        const { projectName } = await ownerOnPeople(page, "Invite");
        const email = `${unique("new")}@example.com`;

        const answer = await add(page, email);
        expect(answer.emailed).toBe(true);
        await expect(page.getByText(`Emailed to ${email}.`)).toBeVisible();
        // The link stays on screen too: an email can still be lost.
        const copied = (await page.locator("code", { hasText: "/register" }).innerText()).trim();

        const letter = await mail.next();
        expect(letter.to).toEqual([email]);
        expect(letter.from).toBe("board@example.com");
        expect(letter.text).toContain(`Owner Person invited you to the project ${projectName}`);
        expect(letter.text).toContain("with this same email address");
        const link = /(https?:\/\/\S+\/register)\s/.exec(letter.text)?.[1];
        // The same origin the screen uses, so the two links are one link.
        expect(link).toBe(copied);

        // The emailed link, followed with the same email, lands in the project.
        const theirs = await browser.newContext();
        const them = await theirs.newPage();
        await them.goto(link!);
        await them.getByPlaceholder("Ada Lovelace").fill("Newcomer");
        await them.getByPlaceholder("you@example.com").fill(email);
        await them.getByPlaceholder("At least 8 characters").fill("ushabti-secret");
        await them.getByRole("button", { name: "Create account" }).click();
        await them.waitForURL("**/projects");
        await expect(them.getByText(projectName)).toBeVisible();
        await theirs.close();
      } finally {
        await mail.stop();
      }
    });

    test("a reset link reaches the member's email, and the emailed link works", async ({
      page,
      browser,
    }) => {
      const mail = await smtpReceiver(smtpPort);
      try {
        const account = await member(browser, "Ada Lovelace");
        const { projectName } = await ownerOnPeople(page, "Reset mail");
        await add(page, account.email);
        await expect(page.getByText("Ada Lovelace")).toBeVisible();

        const answer = await makeLink(page);
        expect(answer.emailed).toBe(true);
        const box = page.getByTestId("reset-link");
        await expect(box).toContainText(`Emailed to ${account.email}.`);
        await expect(box).toContainText("It works once, for 24 hours.");
        await expect(box.locator("code")).toHaveText(answer.link);

        const letter = await mail.next();
        expect(letter.to).toEqual([account.email]);
        expect(letter.text).toContain("It works once, for 24 hours.");
        const link = /(https?:\/\/\S+\/reset\/ushr_\S+)/.exec(letter.text)?.[1];
        expect(link).toBe(answer.link);

        const theirs = await browser.newContext();
        const them = await theirs.newPage();
        await them.goto(link!);
        await them.getByLabel("Your new password").fill("an-emailed-secret");
        await them.getByRole("button", { name: "Set the password" }).click();
        await them.waitForURL("**/projects");
        await expect(them.getByText(projectName)).toBeVisible();
        await theirs.close();
      } finally {
        await mail.stop();
      }
    });

    test("a send that fails says so, and keeps the invite and the link", async ({
      page,
      browser,
    }) => {
      // Nothing listens on the port, so every send is refused.
      const account = await member(browser, "Grace Hopper");
      const { projectId } = await ownerOnPeople(page, "No mail");

      const email = `${unique("lost")}@example.com`;
      const invite = await add(page, email);
      expect(invite.emailed).toBe(false);
      await expect(page.getByText(`Could not email ${email}. Send them this link.`)).toBeVisible();
      await expect(page.locator("code", { hasText: "/register" })).toBeVisible();
      const invites = await inDatabase(async (client) => {
        const { rows } = await client.query(
          "select 1 from project_invites where project_id = $1 and email = $2",
          [projectId, email],
        );
        return rows.length;
      });
      expect(invites).toBe(1);

      await add(page, account.email);
      await expect(page.getByText("Grace Hopper")).toBeVisible();
      const reset = await makeLink(page);
      expect(reset.emailed).toBe(false);
      const box = page.getByTestId("reset-link");
      await expect(box).toContainText(`Could not email ${account.email}. Send them this link.`);
      await expect(box.locator("code")).toHaveText(reset.link);

      // The link was written before the send, so it still opens the account.
      const theirs = await browser.newContext();
      const them = await theirs.newPage();
      await them.goto(reset.link);
      await them.getByLabel("Your new password").fill("a-kept-secret");
      await them.getByRole("button", { name: "Set the password" }).click();
      await them.waitForURL("**/projects");
      await theirs.close();
    });
  });
}

function mailOff() {
  test.describe("Mail, with no SMTP_URL", () => {
    test("the invite and the reset link read as they did before mail", async ({
      page,
      browser,
    }) => {
      const account = await member(browser, "Ada Lovelace");
      await ownerOnPeople(page, "Quiet");

      const email = `${unique("new")}@example.com`;
      const invite = await add(page, email);
      expect(invite.emailed).toBe(false);
      await expect(
        page.getByText(`${email} has no account yet, so it is invited. Send them this link;`),
      ).toBeVisible();

      await add(page, account.email);
      await expect(page.getByText("Ada Lovelace")).toBeVisible();
      const reset = await makeLink(page);
      expect(reset.emailed).toBe(false);
      const box = page.getByTestId("reset-link");
      await expect(box).toContainText("Send this to Ada Lovelace. It works once, for 24 hours.");

      await expect(page.getByText(/Emailed to|Could not email/)).toHaveCount(0);
    });
  });
}
