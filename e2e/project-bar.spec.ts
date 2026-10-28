import { expect, test, type Locator, type Page } from "@playwright/test";
import { createProject, pastTheBar, register, unique } from "./helpers";

/*
 * A project page's bar opens on the project. The sidebar leads Home, folded,
 * open and as a phone's sheet, so the Ushabti mark in front of the project was
 * a second way to the same place. Where no sidebar is drawn — one project and
 * no list — the mark stays, because then it is the only way back.
 */

const sidebar = (page: Page) => page.getByTestId("sidebar");
const where = (page: Page) => page.getByRole("navigation", { name: "Where you are" });

/** Two projects, so the sidebar is drawn. The second one made is open. */
async function twoProjects(page: Page) {
  const other = await createProject(page, unique("Harbour"));
  const open = await createProject(page, unique("Lantern"));
  expect((await page.request.post(`/api/projects/${open}/releases`)).ok()).toBe(true);
  return { other, open };
}

/** Whether the first thing in the bar holds the element with this test id. */
async function opensOn(bar: Locator, testId: string): Promise<boolean> {
  return bar.evaluate(
    (el, id) => !!el.firstElementChild?.querySelector(`[data-testid="${id}"]`),
    testId,
  );
}

test.describe("A project's top bar", () => {
  test("opens on the project, on the board and on each page off it", async ({ page }, testInfo) => {
    await register(page, "Bar Reader");
    const { open } = await twoProjects(page);

    await page.goto(`/p/${open}`);
    const top = page.getByTestId("top-bar");
    await expect(top.getByTestId("board-mark")).toBeVisible();
    await expect(top.locator('a[href="/projects"]')).toHaveCount(0);
    expect(await opensOn(top, "board-mark")).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("seen-board-bar.png") });

    for (const [path, here] of [
      [`/p/${open}/settings/properties`, "Settings"],
      [`/p/${open}/archived`, "Archived"],
      [`/p/${open}/changelog`, "Changelog"],
    ]) {
      await page.goto(path);
      const nav = where(page);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(here);
      await expect(nav.locator('a[href="/projects"]')).toHaveCount(0);
      expect(await opensOn(nav, "project-crumb"), path).toBe(true);
      /* Project, one slash, the page. */
      expect((await nav.innerText()).match(/\//g), path).toHaveLength(1);
    }
    await page.goto(`/p/${open}/settings/properties`);
    await page.screenshot({ path: testInfo.outputPath("seen-settings-bar.png") });
  });

  test("pages with no project lead Home once, from the sidebar", async ({ page }) => {
    await register(page, "Bar Keeper");
    await twoProjects(page);
    for (const path of ["/projects", "/account", "/lists/new"]) {
      await page.goto(path);
      /* The sidebar's mark leads Home, so the bar does not repeat it. */
      await expect(
        sidebar(page).getByRole("link", { name: "Home", exact: true }),
        path,
      ).toHaveAttribute("href", "/projects");
      await expect(where(page).getByRole("link", { name: "Ushabti" }), path).toHaveCount(0);
    }
  });

  test("Home is a click away through the sidebar, folded, open and on a phone", async ({
    page,
  }) => {
    await register(page, "Way Home");
    const { open } = await twoProjects(page);
    const home = () => page.waitForURL("**/projects");

    await page.goto(`/p/${open}`);
    await expect(sidebar(page)).toHaveAttribute("data-folded", "true");
    await sidebar(page).getByRole("link", { name: "Home", exact: true }).click();
    await home();

    await page.goto(`/p/${open}`);
    await page.getByTestId("sidebar-fold").click();
    await expect(sidebar(page)).toHaveAttribute("data-folded", "false");
    await sidebar(page).getByRole("link", { name: "Home", exact: true }).click();
    await home();

    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(`/p/${open}`);
    await expect(sidebar(page)).toBeHidden();
    await page.getByTestId("sidebar-sheet-open").click();
    await page.getByRole("menuitem", { name: "Home" }).click();
    await home();
  });

  test("with no sidebar drawn, the mark still leads Home", async ({ page }) => {
    await register(page, "Only One");
    const only = await createProject(page, unique("Only"));
    await expect(page.getByTestId("top-bar")).toBeVisible();
    await expect(sidebar(page)).toHaveCount(0);

    const top = page.getByTestId("top-bar");
    await expect(top.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/projects");

    await page.goto(`/p/${only}/settings/properties`);
    await expect(where(page).getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/projects",
    );

    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(`/p/${only}`);
    await expect(top.getByRole("link", { name: "Home" })).toBeVisible();
    expect(await pastTheBar(page)).toBe(0);
    await top.getByRole("link", { name: "Home" }).click();
    await page.waitForURL("**/projects");
  });
});
