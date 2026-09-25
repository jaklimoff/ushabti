import { expect, test, type Page } from "@playwright/test";
import {
  addTask,
  card,
  createProject,
  gotoSettings,
  overflow,
  pastTheBar,
  register,
  showColumn,
  unique,
} from "./helpers";

function switcher(page: Page) {
  return page.getByTestId("project-switcher");
}

function menu(page: Page) {
  return page.getByRole("menu", { name: "Projects" });
}

/*
 * The project name is the one way to another project. It used to be the user
 * menu, then a whole page, then a click: four steps for a person who does it
 * many times a day.
 */
test.describe("The project switcher", () => {
  test("lists my projects, marks this one, and opens the one I pick", async ({ page }) => {
    await register(page);
    const first = unique("Harbour");
    const second = unique("Lantern");
    const firstId = await createProject(page, first);
    const secondId = await createProject(page, second);

    await switcher(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: second })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByRole("menuitemradio", { name: first })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByRole("menuitem", { name: "New project" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "All projects" })).toBeVisible();
    /* Eight projects or fewer need no box. */
    await expect(page.getByTestId("project-switcher-find")).toHaveCount(0);

    await page.getByRole("menuitemradio", { name: first }).click();
    await page.waitForURL(`**/p/${firstId}`);
    await expect(page.getByTestId("board-crumb")).toHaveText(first);
    await expect(menu(page)).toBeHidden();

    /* The user menu no longer holds a second way to the same place. */
    await page.getByTestId("user-name").click();
    await expect(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "All projects" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    expect(secondId).not.toBe(firstId);
  });

  test("walks with the arrow keys, opens with Enter and gives the focus back", async ({ page }) => {
    await register(page);
    const first = unique("Harbour");
    const second = unique("Lantern");
    const firstId = await createProject(page, first);
    await createProject(page, second);

    await switcher(page).focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeFocused();

    /* Escape puts it away and the focus is back on the name. */
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(switcher(page)).toBeFocused();

    /* The highlight starts on this project. Up goes to the one before it. */
    await page.keyboard.press("ArrowDown");
    await expect(menu(page)).toBeFocused();
    /* The menu opens on this project alone and the list follows. A walk
       before it arrives would wrap onto All projects. */
    await expect(page.getByRole("menuitemradio")).toHaveCount(2);
    await page.keyboard.press("ArrowUp");
    const at = await menu(page).getAttribute("aria-activedescendant");
    await expect(page.locator(`[id="${at}"]`)).toHaveAccessibleName(first);
    await page.keyboard.press("Enter");
    await page.waitForURL(`**/p/${firstId}`);
    await expect(page.getByTestId("board-crumb")).toHaveText(first);
  });

  test("is the same menu in Settings and Archived, and the name is not a link", async ({
    page,
  }) => {
    await register(page);
    const name = unique("Harbour");
    const projectId = await createProject(page, name);

    for (const go of [
      () => gotoSettings(page, projectId, "views"),
      () => page.goto(`/p/${projectId}/archived`),
    ]) {
      await go();
      await expect(switcher(page)).toBeVisible();
      await expect(page.getByRole("link", { name })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Back to board" })).toBeVisible();
      await switcher(page).click();
      await expect(page.getByRole("menuitemradio", { name })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await page.keyboard.press("Escape");
      await expect(switcher(page)).toBeFocused();
    }

    /* New project opens the one form there is, already open. */
    await switcher(page).click();
    await page.getByRole("menuitem", { name: "New project" }).click();
    await page.waitForURL("**/projects?new");
    await expect(page.getByPlaceholder("Project name")).toBeFocused();
  });

  test("shows a box to find a project only past eight", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Harbour"));
    for (let i = 0; i < 8; i++) {
      const made = await page.request.post("/api/projects", {
        data: { name: `Spare ${i}`, key: `SP${i}` },
      });
      expect(made.ok()).toBe(true);
    }
    await page.goto(`/p/${projectId}`);

    await switcher(page).click();
    const find = page.getByTestId("project-switcher-find");
    await expect(find).toBeFocused();
    await expect(page.getByRole("menuitemradio")).toHaveCount(9);

    await find.fill("spare 7");
    await expect(page.getByRole("menuitemradio")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("board-crumb")).toHaveText("Spare 7");
  });
});

test.describe("The project switcher on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("opens from the mark and stays on the screen", async ({ page }) => {
    await register(page);
    const first = unique("Harbour");
    const firstId = await createProject(page, first);
    await createProject(page, unique("Lantern"));

    /* The name is gone at this width; the mark is the button. */
    await expect(page.getByTestId("board-crumb")).toBeHidden();
    await expect(page.getByTestId("board-mark")).toBeVisible();
    await switcher(page).click();

    const box = await menu(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await overflow(page)).toBe(0);

    await page.getByRole("menuitemradio", { name: first }).click();
    await page.waitForURL(`**/p/${firstId}`);
  });
});

/* A question from the pick bar takes the last of a small tablet's bar, the
   mark included. The mark is the switcher's button, so the caret must not
   stay behind alone and take that room back. */
test.describe("The project switcher while the pick bar asks", () => {
  test.use({ viewport: { width: 540, height: 820 } });

  test("goes with the mark, and nothing is pushed off the bar", async ({ page }) => {
    await register(page, "Wilhelmina Featherstonehaugh");
    await createProject(page, unique("Pocket"));
    for (const title of ["Aardvark", "Beetle"]) {
      await addTask(page, "Todo", title);
      await page.getByRole("button", { name: "Close task" }).click();
    }
    await showColumn(page, "Todo");
    for (const title of ["Aardvark", "Beetle"]) {
      await card(page, title).getByTestId("card-pick").click();
    }
    await expect(page.getByTestId("project-switcher")).toBeVisible();

    await page.getByTestId("pick-archive").click();
    await expect(page.getByTestId("project-switcher")).toBeHidden();
    expect(await pastTheBar(page)).toBe(0);
  });
});
