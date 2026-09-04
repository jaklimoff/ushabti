import { expect, test } from "@playwright/test";
import {
  column,
  createProject,
  dragOnto,
  gotoSettings,
  register,
  saved,
  unique,
  viewRowOrder,
} from "./helpers";

test.describe("Settings", () => {
  test("a failure says what went wrong", async ({ page }) => {
    await register(page, "Owner Person");
    const projectId = await createProject(page, unique("Errors"));

    // This page used to call notify() and render no toasts at all, so every
    // one of these answers arrived on a screen that showed nothing.
    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Email of the new member").fill("nobody-at-all@example.com");
    await page.getByRole("button", { name: "Add member" }).click();

    await expect(
      page.getByText("No account uses that email. Ask them to register first."),
    ).toBeVisible();
    // …and the way out is right there.
    await expect(page.getByRole("button", { name: "Copy the sign-up link" })).toBeVisible();
  });

  test("each section has its own address", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Rail"));

    await page.goto(`/p/${projectId}/settings`);
    await expect(page).toHaveURL(/\/settings\/properties$/);

    await page.getByRole("link", { name: /^People/ }).click();
    await expect(page).toHaveURL(/\/settings\/people$/);
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

    await page.getByRole("link", { name: /^Views/ }).click();
    await expect(page).toHaveURL(/\/settings\/views$/);
  });

  test("a view can be created and deleted from settings", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Views"));

    await gotoSettings(page, projectId, "views");
    await page.getByLabel("Name of the new view").fill("By assignee");
    await page.getByLabel("Grouping property of the new view").selectOption({ label: "Assignee" });
    await page.getByRole("button", { name: "Add view" }).click();
    await expect(page.getByLabel("Name of the view By assignee")).toBeVisible();

    await page.getByRole("button", { name: "Delete the view By assignee" }).click();
    await expect(page.getByText(/Delete the view By assignee\?/)).toBeVisible();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page.getByLabel("Name of the view By assignee")).toHaveCount(0);
  });

  test("a view is dragged into its place, and stays there", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("ViewOrder"));

    await gotoSettings(page, projectId, "views");
    expect(await viewRowOrder(page)).toEqual(["BOARD", "PHASES"]);

    await dragOnto(
      page,
      page.getByRole("button", { name: "Reorder the view Phases" }),
      page.getByLabel("Name of the view Board"),
      /^\/api\/views\/[0-9a-f-]+$/,
    );
    expect(await viewRowOrder(page)).toEqual(["PHASES", "BOARD"]);

    // The order is one order, so the strip above the board reads the same.
    await page.goto(`/p/${projectId}`);
    expect(
      (await page.getByTestId("view-pill").allInnerTexts()).map((t) => t.trim().toUpperCase()),
    ).toEqual(["PHASES", "BOARD"]);
  });

  test("the keyboard moves a view as well as the pointer", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("ViewKeys"));

    await gotoSettings(page, projectId, "views");
    await page.getByRole("button", { name: "Reorder the view Board" }).focus();

    // Space lifts the row, the arrows move it, Space puts it down.
    await page.keyboard.press("Space");
    // dnd-kit measures the rows after the lift, so the first arrow needs the
    // frame that comes with it.
    await page.waitForTimeout(120);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(120);
    await page.keyboard.press("Space");

    await expect.poll(async () => viewRowOrder(page)).toEqual(["PHASES", "BOARD"]);
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

  test("changing the project key warns about the tasks it renames", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Keys"));

    await page.goto(`/p/${projectId}`);
    await page.getByRole("button", { name: "Add a task to Todo" }).first().click();
    const input = page.getByPlaceholder("What needs doing?");
    await input.fill("Named after the key");
    await input.press("Enter");
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "project");
    await page.getByLabel("Project key", { exact: true }).fill("ZZZ");
    await expect(page.getByText(/1 task is called .*today/)).toBeVisible();
  });

  test("the project delete asks for the key", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Doomed"));

    await gotoSettings(page, projectId, "project");
    await page.getByRole("button", { name: "Delete project" }).click();

    const go = page.getByRole("button", { name: "Delete for good" });
    await expect(go).toBeDisabled();

    const key = await page.getByLabel("Project key", { exact: true }).inputValue();
    await page.getByLabel("Type the project key to confirm").fill(key);
    await expect(go).toBeEnabled();
    await go.click();
    await page.waitForURL("**/projects");
  });

  test("a new board says where its columns come from", async ({ page }) => {
    await register(page);
    await createProject(page, unique("First"));

    await expect(page.getByText(/every field on a task is yours to rename/i)).toBeVisible();

    await page.getByRole("button", { name: "Add a task to Todo" }).first().click();
    const input = page.getByPlaceholder("What needs doing?");
    await input.fill("Now it is a real board");
    await input.press("Enter");
    await page.getByRole("button", { name: "Close task" }).click();

    // It is guidance for an empty board, not furniture.
    await expect(page.getByText(/every field on a task is yours to rename/i)).toHaveCount(0);
    await expect(column(page, "Todo")).toBeVisible();
  });
});
