import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  addMember,
  createProject,
  gotoSettings,
  inDatabase,
  letterTo,
  register,
  unique,
} from "./helpers";
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
async function makeLink(page: Page): Promise<{ link?: string; emailed?: boolean }> {
  const answer = page.waitForResponse(
    (res) => res.request().method() === "POST" && /\/reset$/.test(new URL(res.url()).pathname),
  );
  await page.getByRole("button", { name: "Reset password" }).click();
  await page.getByRole("button", { name: "Yes, make a link" }).click();
  return (await (await answer).json()) as { link?: string; emailed?: boolean };
}

/** Somebody with an account, signed in in a browser of their own. */
async function member(browser: Browser, name: string) {
  const page = await (await browser.newContext()).newPage();
  const account = await register(page, name);
  return { ...account, page };
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

    test("an invite to a new email reaches the mail server with its own link", async ({
      page,
      browser,
    }) => {
      const mail = await smtpReceiver(smtpPort);
      try {
        const { projectName } = await ownerOnPeople(page, "Invite");
        const email = `${unique("new")}@example.com`;

        const answer = (await add(page, email)) as { emailed?: boolean; link?: string };
        expect(answer.emailed).toBe(true);
        await expect(page.getByText(`Emailed to ${email}.`)).toBeVisible();
        // The link stays on screen too: an email can still be lost.
        const copied = (await page.locator("code", { hasText: "/invite/" }).innerText()).trim();
        expect(copied).toBe(answer.link);

        const letter = await letterTo(mail, email);
        expect(letter.to).toEqual([email]);
        expect(letter.from).toBe("board@example.com");
        expect(letter.text).toContain(`Owner Person invited you to the project ${projectName}`);
        expect(letter.text).toContain("with this same email address");
        expect(letter.text).toContain("The link works once, for 7 days.");
        const link = /(https?:\/\/\S+\/invite\/ushi_\S+)/.exec(letter.text)?.[1];
        // The same origin the screen uses, so the two links are one link.
        expect(link).toBe(copied);

        // The emailed link, followed with the same email, lands in the project.
        const theirs = await browser.newContext();
        const them = await theirs.newPage();
        await them.goto(link!);
        await them.getByRole("button", { name: "Create an account" }).click();
        await them.getByPlaceholder("Ada Lovelace").fill("Newcomer");
        await expect(them.getByPlaceholder("you@example.com")).toHaveValue(email);
        await them.getByLabel("Your password").fill("ushabti-secret");
        await them.getByRole("button", { name: "Create account" }).click();
        await them.waitForURL(/\/p\/[\w-]+$/);
        await expect(them.getByText(projectName)).toBeVisible();
        await theirs.close();
      } finally {
        await mail.stop();
      }
    });

    test("a reset link reaches the member's email only, and the emailed link works", async ({
      page,
      browser,
    }, testInfo) => {
      const mail = await smtpReceiver(smtpPort);
      try {
        const account = await member(browser, "Ada Lovelace");
        const { projectName } = await ownerOnPeople(page, "Reset mail");
        // An account is invited as anybody is, and joins from the emailed link.
        expect(await add(page, account.email)).toMatchObject({ emailed: true });
        const invited = await letterTo(mail, account.email);
        const join = /(https?:\/\/\S+\/invite\/ushi_\S+)/.exec(invited.text)?.[1];
        expect(join).toBeTruthy();
        await account.page.goto(join!);
        await account.page.getByRole("button", { name: `Join ${projectName}` }).click();
        await account.page.waitForURL(/\/p\/[\w-]+$/);
        await account.page.context().close();
        await page.reload();
        await expect(page.getByText("Ada Lovelace")).toBeVisible();

        const answer = await makeLink(page);
        // The mailbox is the member's: the link never comes back to the admin.
        expect(answer).toEqual({ emailed: true });
        const box = page.getByTestId("reset-link");
        await expect(box).toContainText(`Emailed to ${account.email}.`);
        await expect(box).toContainText("It works once, for 24 hours.");
        await expect(box.locator("code")).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath("seen-reset-emailed.png") });

        const letter = await letterTo(mail, account.email);
        expect(letter.to).toEqual([account.email]);
        expect(letter.text).toContain("It works once, for 24 hours.");
        const link = /(https?:\/\/\S+\/reset\/ushr_\S+)/.exec(letter.text)?.[1];
        expect(link).toBeTruthy();

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

    test("a send that fails says so, keeps the invite, and shows no reset link", async ({
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
      await expect(page.locator("code", { hasText: "/invite/" })).toBeVisible();
      const invites = await inDatabase(async (client) => {
        const { rows } = await client.query(
          "select 1 from project_invites where project_id = $1 and email = $2",
          [projectId, email],
        );
        return rows.length;
      });
      expect(invites).toBe(1);

      await addMember(page, projectId, account.page, account.email);
      await account.page.context().close();
      await page.reload();
      await expect(page.getByText("Grace Hopper")).toBeVisible();
      const reset = await makeLink(page);
      // A lost email is not a reason to hand the link to somebody else.
      expect(reset).toEqual({ emailed: false });
      const box = page.getByTestId("reset-link");
      await expect(box).toContainText(
        `Could not email ${account.email}. Make a new link to try again.`,
      );
      await expect(box.locator("code")).toHaveCount(0);
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
      const { projectId } = await ownerOnPeople(page, "Quiet");

      const email = `${unique("new")}@example.com`;
      const invite = await add(page, email);
      expect(invite.emailed).toBe(false);
      await expect(
        page.getByText(`${email} is invited. Send them this link; they join when they open it`),
      ).toBeVisible();

      await addMember(page, projectId, account.page, account.email);
      await account.page.context().close();
      await page.reload();
      await expect(page.getByText("Ada Lovelace")).toBeVisible();
      const reset = await makeLink(page);
      expect(reset.emailed).toBe(false);
      const box = page.getByTestId("reset-link");
      await expect(box).toContainText("Send this to Ada Lovelace. It works once, for 24 hours.");

      await expect(page.getByText(/Emailed to|Could not email/)).toHaveCount(0);
    });
  });
}
