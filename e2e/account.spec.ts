import { expect, test } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

/*
 * One walk: the menu reaches the page, and the board follows the name. The
 * colour, the faces and the password boxes are `Account.test.tsx`; what the
 * server keeps and refuses is `account-route.test.ts`.
 */
test.describe("Your own account", () => {
  // Was "a name and a colour can be changed, and the board follows" and
  // "the account page is reachable from the user menu".
  test("the account page is reached from the user menu, and the board follows the name", async ({
    page,
  }) => {
    const account = await register(page, "Mistyped Nmae");
    const projectId = await createProject(page, unique("Account"));
    await addTask(page, "Todo", "Whose is this");
    await page.getByRole("button", { name: "Close task" }).click();

    await page.goto("/projects");
    await page.getByRole("button", { name: /Mistyped Nmae/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByText(account.email)).toBeVisible();

    const name = page.getByLabel("Your name");
    await name.fill("Ada Lovelace");
    await name.blur();
    await expect(page.getByTestId("toast")).toContainText("Saved.");

    await page.goto(`/p/${projectId}`);
    await expect(page.getByRole("button", { name: /Ada Lovelace/ })).toBeVisible();
  });
});
