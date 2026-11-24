import { expect, test } from "@playwright/test";
import { column, createProject, register, unique } from "./helpers";

/*
 * New project is a page of its own. It used to be a form at the end of Home's
 * grid, often below the fold, so the sidebar's + read as doing nothing.
 */

test("New project opens its own page, makes the project and opens its board", async ({
  page,
}, testInfo) => {
  await register(page, "New Project Person");
  /* The sidebar comes with a second project. */
  await createProject(page, unique("Before"));
  await createProject(page, unique("Also"));

  /* The sidebar's + goes to the page, and says you are there. */
  await page.goto("/projects");
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveCount(0);
  await page.getByTestId("sidebar").getByRole("link", { name: "New project" }).click();
  await page.waitForURL(/\/projects\/new$/);
  await expect(page).toHaveTitle("New project · Ushabti");
  await expect(page.getByRole("heading", { level: 1, name: "New project" })).toBeVisible();
  await expect(
    page.getByText(
      "A project is one board of tasks, shared with the people and agents you invite.",
    ),
  ).toBeVisible();
  await expect(
    page.getByTestId("sidebar").getByRole("link", { name: "New project" }),
  ).toHaveAttribute("aria-current", "page");
  const nameBox = page.getByRole("textbox", { name: "Project name" });
  await expect(nameBox).toBeFocused();
  const keyBox = page.getByRole("textbox", { name: "Project key" });
  await expect(page.getByText("Task keys will look like WR-14.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("seen-new-project.png") });

  /* The key waits for the name to be left, then follows it. */
  await nameBox.fill("Willow Road");
  await expect(keyBox).toHaveValue("");
  await keyBox.focus();
  await expect(keyBox).toHaveValue("WR");
  await expect(
    page.getByText("Task keys will look like WR-14. Changing the key later renames every task."),
  ).toBeVisible();
  await keyBox.fill("WRD");
  await expect(page.getByText("Task keys will look like WRD-14.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("seen-new-project-filled.png") });

  /* Cancel goes Home and makes nothing. */
  await page.getByRole("link", { name: "Cancel" }).click();
  await page.waitForURL(/\/projects$/);

  /* Home's + New project, and an old ?new link, both land on the page. */
  await page.getByRole("link", { name: "+ New project" }).click();
  await page.waitForURL(/\/projects\/new$/);
  await page.goto("/projects?new");
  await page.waitForURL(/\/projects\/new$/);

  const name = unique("Willow");
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}/);
  await expect(column(page, "Later")).toBeVisible();
});

test("a visitor who is not signed in is sent to sign in", async ({ page }) => {
  await page.goto("/projects/new");
  await expect(page).toHaveURL(/\/login/);
});
