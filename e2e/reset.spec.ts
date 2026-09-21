import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import { createProject, gotoSettings, register, signIn, unique } from "./helpers";

const DEAD = "This link does not work any more. Ask the owner of your project for a new one.";

/**
 * Presses Reset password on the member's row and answers the question.
 *
 * `previous` is the link the row is already showing, if any: the box is on
 * screen before the answer comes back, so without waiting for the text to
 * change this reads the old link and calls it the new one.
 */
async function makeLink(page: Page, previous?: string): Promise<string> {
  await page.getByRole("button", { name: "Reset password" }).click();
  await page.getByRole("button", { name: "Yes, make a link" }).click();
  const box = page.getByTestId("reset-link");
  await expect(box).toContainText("It works once, for 24 hours.");
  const code = box.locator("code");
  if (previous) await expect(code).not.toHaveText(previous);
  return (await code.innerText()).trim();
}

/**
 * A browser of its own, from an address of its own.
 *
 * A dead link is counted against the calling address, on the page as well as
 * on the route. Every other test signs in from 127.0.0.1 and never fails, so
 * the suite never meets the limit. This one spends four of the ten tries —
 * three dead pages and one dead call — which is why it must not spend them
 * where anybody else is counting.
 *
 * The address is made here, inside the test, so every run and every retry
 * takes a fresh one. Two retries on one address would be twelve failures
 * against `TRIES = 10`, and a correct build would fail on the third go.
 */
async function guesser(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": unique("198.51.100") },
  });
  return context.newPage();
}

/** The one place this spec reaches past the screen. */
async function inDatabase<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://ushabti:ushabti@localhost:5435/ushabti",
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** How many link rows this account still has. */
async function linkRows(email: string): Promise<number> {
  return inDatabase(async (client) => {
    const { rows } = await client.query<{ count: number }>(
      `select count(*)::int as count
         from password_resets r
         join users u on u.id = r.user_id
        where u.email = $1`,
      [email],
    );
    return Number(rows[0].count);
  });
}

/** Moves this account's links back, so their day is over. */
async function ageLinks(email: string, hours: number): Promise<void> {
  await inDatabase(async (client) => {
    await client.query(
      `update password_resets r
          set created_at = now() - ($2 || ' hours')::interval,
              expires_at = now() - ($2 || ' hours')::interval + interval '24 hours'
         from users u
        where u.id = r.user_id and u.email = $1`,
      [email, String(hours)],
    );
  });
}

test.describe("A forgotten password", () => {
  test("the owner makes a link, it works once, and the new password signs in", async ({
    page,
    browser,
  }) => {
    /* The person who forgot. They keep a browser that is still signed in, so
       the test can watch that session end. */
    const theirs = await browser.newContext();
    const them = await theirs.newPage();
    const member = await register(them, "Ada Lovelace");

    await register(page, "Owner Person");
    const projectName = unique("Reset");
    const projectId = await createProject(page, projectName);
    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Email of the new member").fill(member.email);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    // One row offers it: never the owner's own, where /account is the answer.
    await expect(page.getByRole("button", { name: "Reset password" })).toHaveCount(1);

    // The row asks before it hands out access to somebody's account.
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByText(/Make a reset link for Ada Lovelace\?/)).toBeVisible();
    await page.getByRole("button", { name: "Yes, make a link" }).click();
    const first = (await page.getByTestId("reset-link").locator("code").innerText()).trim();
    expect(first).toContain("/reset/ushr_");

    // A second link for the same person puts the first one out of use.
    const second = await makeLink(page, first);

    const stranger = await guesser(browser);
    await stranger.goto(first);
    await expect(stranger.getByTestId("reset-dead")).toHaveText(DEAD);

    /* The route says so too, and not only the page. Nothing in a browser can
       reach it with a dead link, so this asks it directly: the update that
       spends a link is the rule, and a superseded one fails it. */
    const refused = await stranger.request.post("/api/auth/reset", {
      data: { token: first.split("/reset/")[1], password: "not-this-one" },
    });
    expect(refused.status()).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe(DEAD);

    // Another browser: a link is sent by hand and opened wherever it lands.
    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    await other.goto(second);
    await other.getByLabel("Your new password").fill("a-second-secret");
    await other.getByRole("button", { name: "Set the password" }).click();
    await other.waitForURL("**/projects");
    await expect(other.getByText(projectName)).toBeVisible();

    // The session they left behind is over.
    await them.goto("/projects");
    await them.waitForURL("**/login");

    /* The link is spent. One sentence, and nothing to do: no form, no field,
       no way on — and nothing that says whether an account exists. */
    await stranger.goto(second);
    await expect(stranger.getByTestId("reset-dead")).toHaveText(DEAD);
    await expect(stranger.locator("form, input, button, a")).toHaveCount(0);

    // An invented token reads exactly the same.
    await stranger.goto("/reset/ushr_nothing-was-ever-made-with-this");
    await expect(stranger.getByTestId("reset-dead")).toHaveText(DEAD);
    await expect(stranger.locator("form, input, button, a")).toHaveCount(0);

    // And the new password is the password now.
    await signIn(them, { ...member, password: "a-second-secret" });
    await expect(them.getByText(projectName)).toBeVisible();

    await theirs.close();
    await fresh.close();
    await stranger.context().close();
  });

  test("a spent link and an old one go when the next one is made", async ({ page, browser }) => {
    /* One row arrives per link, and nothing ever took one away. The sweep is on
       the write, so this watches the table across three links. */
    const theirs = await browser.newContext();
    const them = await theirs.newPage();
    const member = await register(them, "Grace Hopper");

    await register(page, "Owner Person");
    const projectId = await createProject(page, unique("Sweep"));
    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Email of the new member").fill(member.email);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Grace Hopper")).toBeVisible();

    const first = await makeLink(page);
    expect(await linkRows(member.email)).toBe(1);

    // Older than its day. Nothing reads it away, so it waits for the next link.
    await ageLinks(member.email, 25);
    const second = await makeLink(page, first);
    expect(await linkRows(member.email)).toBe(1);

    // A spent link goes the same way.
    await them.goto(second);
    await them.getByLabel("Your new password").fill("a-third-secret");
    await them.getByRole("button", { name: "Set the password" }).click();
    await them.waitForURL("**/projects");

    await makeLink(page, second);
    expect(await linkRows(member.email)).toBe(1);

    await theirs.close();
  });
});
