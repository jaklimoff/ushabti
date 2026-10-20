import { createHash } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createProject, gotoSettings, inDatabase, register, unique } from "./helpers";

/**
 * An invite is a link. The email alone opens nothing, because nothing in
 * Ushabti proves that somebody owns an address; only the link the owner sent
 * there does. Sign-up closed is the server's environment, so that half is
 * `register.test.ts`.
 */

const DEAD = "This invite does not work any more.";

function freshEmail(prefix: string) {
  return `${unique(prefix).toLowerCase().replace(/\s+/g, "-")}@example.com`;
}

/** An owner on the People page of a project of their own. */
async function ownerOnPeople(page: Page, prefix: string) {
  const owner = await register(page, "Owner Person");
  const projectName = unique(prefix);
  const projectId = await createProject(page, projectName);
  await gotoSettings(page, projectId, "people");
  return { owner, projectId, projectName };
}

/** Adds somebody by email, and answers what the route said. */
async function add(page: Page, email: string) {
  const answer = page.waitForResponse(
    (res) => res.request().method() === "POST" && /\/members$/.test(new URL(res.url()).pathname),
  );
  await page.getByLabel("Email of the new member").fill(email);
  await page.getByRole("button", { name: "Add member" }).click();
  const res = await answer;
  return { status: res.status(), ...((await res.json()) as { link?: string; error?: string }) };
}

/* A dead link counts against the sign-up limit of the calling address, as a
   refused sign-up does, and every spec signs up from 127.0.0.1. An address of
   its own per test keeps these dead links out of everybody else's count. */
let address = "";

test.beforeEach(async ({ page }) => {
  address = unique("198.51.100");
  await page.setExtraHTTPHeaders({ "x-forwarded-for": address });
});

/** Somebody in a browser of their own. */
async function stranger(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": address } });
  return { context, page: await context.newPage() };
}

async function signUpOn(page: Page, url: string, email: string | null, name: string) {
  await page.goto(url);
  await page.getByLabel("Your name").fill(name);
  if (email !== null) await page.getByLabel("Your email").fill(email);
  await page.getByLabel("Your password").fill("password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/projects$/);
}

test.describe("Invites", () => {
  test("the link lets its email in once, and the database keeps only its hash", async ({
    page,
    browser,
  }, testInfo) => {
    const { projectId, projectName } = await ownerOnPeople(page, "Invites");
    const email = freshEmail("guest");

    const invited = await add(page, email);
    expect(invited.status).toBe(201);
    const link = invited.link!;
    expect(link).toMatch(/\/invite\/ushi_[\w-]{43}$/);
    // The owner has the link on screen, to hand over by whatever channel.
    await expect(page.locator("code", { hasText: link })).toBeVisible();
    await expect(page.getByText("It works once, for 7 days.")).toBeVisible();
    const row = page.getByTestId("invite-row").filter({ hasText: email });
    await expect(row.getByText("invited")).toBeVisible();

    const token = link.split("/invite/")[1];
    const stored = await inDatabase(async (client) => {
      const { rows } = await client.query(
        "select row_to_json(i)::text as row, hash from project_invites i where project_id = $1 and email = $2",
        [projectId, email],
      );
      return rows[0] as { row: string; hash: string };
    });
    expect(stored.hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(stored.row).not.toContain(token);

    // A wrong address is refused before it is remembered.
    await page.getByLabel("Email of the new member").fill("not an address");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("That email address does not look correct.")).toBeVisible();

    const guest = await stranger(browser);
    await guest.page.goto(link);
    await expect(guest.page.getByTestId("invite-tagline")).toContainText(
      `You are invited to ${projectName}.`,
    );
    await expect(guest.page.getByLabel("Your email")).toHaveValue(email);
    await expect(guest.page.getByLabel("Your email")).not.toBeEditable();
    await guest.page.screenshot({ path: testInfo.outputPath("seen-invite-page.png") });
    await signUpOn(guest.page, link, null, "Guest Person");
    await expect(guest.page.getByText(projectName)).toBeVisible();
    await guest.context.close();

    // The owner's page follows: the invite is a member now.
    await expect(row).toBeHidden();
    await expect(page.getByText("Guest Person")).toBeVisible();

    // The link is spent.
    const late = await stranger(browser);
    await late.page.goto(link);
    await expect(late.page.getByTestId("invite-dead")).toContainText(DEAD);
    await expect(late.page.getByLabel("Your password")).toHaveCount(0);
    await late.context.close();

    // An invite can be withdrawn, and the row asks first.
    const second = freshEmail("second");
    await add(page, second);
    const secondRow = page.getByTestId("invite-row").filter({ hasText: second });
    await expect(secondRow).toBeVisible();
    await secondRow.getByRole("button", { name: `Withdraw the invite for ${second}` }).click();
    await page.getByRole("button", { name: "Yes, withdraw" }).click();
    await expect(secondRow).toBeHidden();
  });

  test("an invite as an admin shows its role, and its person joins as an admin", async ({
    page,
    browser,
  }, testInfo) => {
    const { projectId, projectName } = await ownerOnPeople(page, "Invite admin");
    const email = freshEmail("admin");

    // The table reads Person and Role, and the owner's own row says "you".
    await expect(page.getByText("Person", { exact: true })).toBeVisible();
    await expect(page.getByText("you", { exact: true })).toBeVisible();

    await page.getByLabel("Role of the new member").click();
    await page.getByRole("option", { name: "Admin", exact: true }).click();
    const invited = await add(page, email);
    expect(invited.status).toBe(201);
    const row = page.getByTestId("invite-row").filter({ hasText: email });
    await expect(row.getByText("Admin", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-members-table.png") });

    const guest = await stranger(browser);
    await signUpOn(guest.page, invited.link!, null, "Admin Person");
    await expect(guest.page.getByText(projectName)).toBeVisible();
    await guest.context.close();

    // The owner's page follows: the invite is an admin now.
    await expect(row).toBeHidden();
    await expect(page.getByLabel("Role of Admin Person")).toContainText("Admin");
    const role = await inDatabase(async (client) => {
      const { rows } = await client.query(
        "select m.role from project_members m join users u on u.id = m.user_id where m.project_id = $1 and u.email = $2",
        [projectId, email],
      );
      return rows[0]?.role as string;
    });
    expect(role).toBe("admin");
  });

  test("an account made with an invited email but without the link joins nothing", async ({
    page,
    browser,
  }) => {
    const { projectId, projectName } = await ownerOnPeople(page, "Squatted");
    const email = freshEmail("squat");
    await add(page, email);

    const squatter = await stranger(browser);
    await signUpOn(squatter.page, "/register", email, "Not Them");
    await expect(squatter.page.getByText(projectName)).toHaveCount(0);
    const members = await inDatabase(async (client) => {
      const { rows } = await client.query(
        "select 1 from project_members m join users u on u.id = m.user_id where m.project_id = $1 and u.email = $2",
        [projectId, email],
      );
      return rows.length;
    });
    expect(members).toBe(0);
    await squatter.context.close();

    // The invite is still the owner's to withdraw; nothing was spent.
    await page.reload();
    await expect(page.getByTestId("invite-row").filter({ hasText: email })).toBeVisible();
  });

  test("a link older than 7 days is refused, and inviting again gives a new one", async ({
    page,
    browser,
  }, testInfo) => {
    const { projectId, projectName } = await ownerOnPeople(page, "Old invite");
    const email = freshEmail("late");
    const old = (await add(page, email)).link!;

    // A week and a minute ago.
    await inDatabase((client) =>
      client.query(
        `update project_invites set created_at = now() - interval '7 days 1 minute',
           expires_at = now() - interval '1 minute' where project_id = $1 and email = $2`,
        [projectId, email],
      ),
    );

    const them = await stranger(browser);
    await them.page.goto(old);
    await expect(them.page.getByTestId("invite-dead")).toHaveText(
      "This invite does not work any more. An invite works once, for 7 days. Ask the person who invited you for a new invite.",
    );
    // The way back to sign in is the same for every token, so it says nothing.
    await expect(them.page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    await them.page.screenshot({ path: testInfo.outputPath("seen-invite-dead.png") });

    await page.reload();
    const row = page.getByTestId("invite-row").filter({ hasText: email });
    await expect(row.getByText("link expired")).toBeVisible();
    const again = await add(page, email);
    expect(again.status).toBe(201);
    expect(again.link).not.toBe(old);
    await expect(row.getByText("invited")).toBeVisible();

    // The old link stays dead; the new one opens the project.
    await them.page.goto(old);
    await expect(them.page.getByTestId("invite-dead")).toBeVisible();
    await signUpOn(them.page, again.link!, null, "Late Person");
    await expect(them.page.getByText(projectName)).toBeVisible();
    await them.context.close();
  });

  test("an invite made before links opens nothing, and People invites the email again", async ({
    page,
    browser,
  }) => {
    const { owner, projectId, projectName } = await ownerOnPeople(page, "Legacy");
    const email = freshEmail("legacy");
    // The row an older release wrote: no hash, no expiry.
    await inDatabase((client) =>
      client.query(
        `insert into project_invites (project_id, email, invited_by)
           select $1, $2, id from users where email = $3`,
        [projectId, email, owner.email],
      ),
    );

    // Its email alone joins nothing.
    const squatter = await stranger(browser);
    await signUpOn(squatter.page, "/register", email, "Legacy Squatter");
    await expect(squatter.page.getByText(projectName)).toHaveCount(0);
    await squatter.context.close();
    await inDatabase((client) => client.query("delete from users where email = $1", [email]));

    await page.reload();
    const row = page.getByTestId("invite-row").filter({ hasText: email });
    await expect(row.getByText("link expired")).toBeVisible();
    const again = await add(page, email);
    expect(again.status).toBe(201);
    await expect(row.getByText("invited")).toBeVisible();

    const them = await stranger(browser);
    await signUpOn(them.page, again.link!, null, "Legacy Person");
    await expect(them.page.getByText(projectName)).toBeVisible();
    await them.context.close();
  });
});
