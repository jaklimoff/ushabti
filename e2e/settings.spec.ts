import { expect, test } from "@playwright/test";
import { column, createProject, gotoSettings, register, saved, unique } from "./helpers";

/*
 * The rest of this file went down in USH-274: the Settings pages are
 * `ViewsPanel.test.tsx`, `ProjectPanel.test.tsx`, `PropertiesPanel.test.tsx`
 * and `SettingsShell.test.tsx`, the empty board's hint is `Board.test.tsx`,
 * and the two counts are `properties-route.test.ts`. These two need a second
 * browser or a reload.
 */
test.describe("Settings", () => {
  test("an unknown email is invited, and joins as it signs up", async ({ page, browser }) => {
    await register(page, "Owner Person");
    const projectId = await createProject(page, unique("Invites"));
    const email = `${unique("guest").toLowerCase().replace(/\s+/g, "-")}@example.com`;

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Email of the new member").fill(email);
    await page.getByRole("button", { name: "Add member" }).click();

    // No account yet, so the email waits, and the way to send the link is right there.
    const invite = page.getByTestId("invite-row").filter({ hasText: email });
    await expect(invite).toBeVisible();
    await expect(invite.getByText("invited")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy the sign-up link" })).toBeVisible();

    // A wrong address is refused before it is remembered.
    await page.getByLabel("Email of the new member").fill("not an address");
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("That email address does not look correct.")).toBeVisible();

    // The guest signs up with that email, in another browser, and is in.
    const other = await browser.newContext();
    const guest = await other.newPage();
    await guest.goto("/register");
    await guest.getByLabel("Your name").fill("Guest Person");
    await guest.getByLabel("Your email").fill(email);
    await guest.getByLabel("Your password").fill("password-123");
    await guest.getByRole("button", { name: "Create account" }).click();
    await guest.waitForURL(/\/projects$/);
    await guest.goto(`/p/${projectId}`);
    await expect(guest.getByText("Invites", { exact: false }).first()).toBeVisible();
    await other.close();

    // The owner's page follows: the invite is a member now.
    await expect(invite).toBeHidden();
    await expect(page.getByText("Guest Person")).toBeVisible();

    // An invite can be withdrawn, and the row asks first.
    const second = `${unique("second").toLowerCase().replace(/\s+/g, "-")}@example.com`;
    await page.getByLabel("Email of the new member").fill(second);
    await page.getByRole("button", { name: "Add member" }).click();
    const secondRow = page.getByTestId("invite-row").filter({ hasText: second });
    await expect(secondRow).toBeVisible();
    await secondRow.getByRole("button", { name: `Withdraw the invite for ${second}` }).click();
    await page.getByRole("button", { name: "Yes, withdraw" }).click();
    await expect(secondRow).toBeHidden();
  });

  test("another view is made the main one, and the board opens on it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("MainView"));

    await gotoSettings(page, projectId, "views");
    // The main view carries the word and cannot be deleted; the other one
    // carries the way to take the word from it.
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete the view Board" })).toHaveCount(0);

    await saved(page, () =>
      page.getByRole("button", { name: "Make Phases the main view" }).click(),
    );

    // One view is main, so the word moved rather than spread.
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Make Phases the main view" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete the view Board" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete the view Phases" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: "Make Board the main view" })).toBeVisible();

    // Nobody has picked a view in this browser, so the board opens on the main
    // one: the Phase columns, and not the Status ones.
    await page.goto(`/p/${projectId}`);
    await expect(column(page, "PoC")).toBeVisible();
  });
});
