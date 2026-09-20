import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, register, signIn, unique } from "./helpers";

const DEAD = "This link does not work any more. Ask the owner of your project for a new one.";

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
    const reset = page.getByRole("button", { name: "Reset password" });
    await expect(reset).toHaveCount(1);

    // The row asks before it hands out access to somebody's account.
    await reset.click();
    await expect(page.getByText(/Make a reset link for Ada Lovelace\?/)).toBeVisible();
    await page.getByRole("button", { name: "Yes, make a link" }).click();

    const box = page.getByTestId("reset-link");
    await expect(box).toContainText("It works once, for 24 hours.");
    const link = (await box.locator("code").innerText()).trim();
    expect(link).toContain("/reset/");

    // Another browser: a link is sent by hand and opened wherever it lands.
    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    await other.goto(link);
    await other.getByLabel("Your new password").fill("a-second-secret");
    await other.getByRole("button", { name: "Set the password" }).click();
    await other.waitForURL("**/projects");
    await expect(other.getByText(projectName)).toBeVisible();

    // The session they left behind is over.
    await them.goto("/projects");
    await them.waitForURL("**/login");

    // The link is spent, and says so without naming an account.
    const again = await browser.newContext();
    const stranger = await again.newPage();
    await stranger.goto(link);
    await expect(stranger.getByText(DEAD)).toBeVisible();
    await expect(stranger.getByRole("button", { name: "Set the password" })).toHaveCount(0);

    // An invented token reads exactly the same.
    await stranger.goto("/reset/ush_nothing-was-ever-made-with-this");
    await expect(stranger.getByText(DEAD)).toBeVisible();

    // And the new password is the password now.
    await signIn(them, { ...member, password: "a-second-secret" });
    await expect(them.getByText(projectName)).toBeVisible();

    await theirs.close();
    await fresh.close();
    await again.close();
  });
});
