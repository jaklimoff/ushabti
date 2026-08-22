import { expect, test } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

test.describe("Your own account", () => {
  test("a name and a colour can be changed, and the board follows", async ({ page }) => {
    const account = await register(page, "Mistyped Nmae");
    const projectId = await createProject(page, unique("Account"));
    await addTask(page, "Todo", "Whose is this");
    await page.getByRole("button", { name: "Close task" }).click();

    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByText(account.email)).toBeVisible();

    const name = page.getByLabel("Your name");
    await name.fill("Ada Lovelace");
    await name.blur();
    await expect(page.getByTestId("toast")).toContainText("Saved.");

    // The palette, not the operating system's colour wheel.
    const swatches = page.getByRole("radio");
    await expect(swatches).toHaveCount(8);
    await swatches.nth(3).click();
    await expect(swatches.nth(3)).toHaveAttribute("aria-checked", "true");

    await page.goto(`/p/${projectId}`);
    await expect(page.getByRole("button", { name: /Ada Lovelace/ })).toBeVisible();
  });

  test("the password needs the old one, and says so when it is wrong", async ({ page }) => {
    await register(page, "Careful Person");

    await page.goto("/account");
    await page.getByLabel("The password you use now").fill("not-the-password");
    await page.getByLabel("The password you want").fill("a-longer-secret");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("That is not the password you use now.")).toBeVisible();

    await page.getByLabel("The password you use now").fill("ushabti-secret");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("toast")).toContainText("Password changed");
  });

  test("the account page is reachable from the user menu", async ({ page }) => {
    await register(page);
    await page.goto("/projects");
    await page.getByRole("button", { name: /Test Person/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await expect(page).toHaveURL(/\/account$/);
  });
});
