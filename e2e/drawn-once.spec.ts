import { expect, test } from "@playwright/test";
import { column, createProject, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

type Board = {
  today: string;
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  views: { id: string; isDefault: boolean }[];
};

async function boardOf(page: Page, projectId: string): Promise<Board> {
  return (await page.request.get(`/api/projects/${projectId}/board`)).json();
}

/** What a press looks like, read off the page rather than off the CSS. */
async function lookOf(button: Locator) {
  return button.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      text: el.textContent,
      tick: el.querySelector("svg") !== null,
      height: css.height,
      font: `${css.fontFamily} ${css.fontSize} ${css.fontWeight}`,
      border: css.borderTopStyle,
    };
  });
}

/*
 * The pieces the design pass drew twice, each drawn once: Ship in a column
 * header and on a roadmap row, and the empty composer at one line. How each
 * piece reads in isolation is in the browser tests.
 */
test.describe("Pieces drawn once", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Ship reads the same in a column header and on the roadmap", async ({ page }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Once"));
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Version", type: "select", options: ["v1", "v2"] },
    });
    expect(made.status()).toBe(201);
    let board = await boardOf(page, projectId);
    const version = board.properties.find((p) => p.name === "Version")!;
    expect(
      (await page.request.patch(`/api/properties/${version.id}`, { data: { dated: true } })).ok(),
    ).toBeTruthy();
    for (const option of version.options) {
      const patched = await page.request.patch(`/api/options/${option.id}`, {
        data: { targetAt: board.today },
      });
      expect(patched.ok()).toBeTruthy();
    }
    board = await boardOf(page, projectId);
    const main = board.views.find((v) => v.isDefault)!;
    expect(
      (await page.request.patch(`/api/views/${main.id}`, { data: { groupById: version.id } })).ok(),
    ).toBeTruthy();

    await page.goto(`/p/${projectId}`);
    const inColumn = column(page, "v1").getByTestId("column-ship");
    await expect(inColumn).toBeVisible();
    await expect(inColumn).toHaveText("Ship");
    const columnLook = await lookOf(inColumn);

    /* The empty composer is one line, until the title needs a second. */
    await page.getByRole("button", { name: "Add a task to v1" }).first().click();
    const box = page.getByPlaceholder("What needs doing?");
    await expect(box).toBeFocused();
    expect((await box.boundingBox())!.height).toBeLessThan(34);
    await page.screenshot({ path: testInfo.outputPath("seen-composer.png") });
    await box.press("Escape");
    await inColumn.hover();
    await page.screenshot({ path: testInfo.outputPath("seen-column-ship.png") });

    await page.getByRole("button", { name: "New view" }).click();
    await page.getByLabel("Name of the new view").fill("Plan");
    await page
      .getByRole("group", { name: "What the new view shows" })
      .getByRole("button", { name: "Roadmap", exact: true })
      .click();
    await page.getByRole("button", { name: "Version", exact: true }).click();
    await page.getByRole("button", { name: "Create view" }).click();
    await expect(page.getByTestId("roadmap-view")).toBeVisible();

    const row = page.getByTestId("roadmap-row").filter({ hasText: "v1" });
    await row.hover();
    const onRoadmap = row.getByTestId("roadmap-ship");
    await expect(onRoadmap).toHaveText("Ship");
    expect(await lookOf(onRoadmap)).toEqual(columnLook);
    await page.screenshot({ path: testInfo.outputPath("seen-roadmap-ship.png") });
  });

  test("a colour swatch says its colour", async ({ page }, testInfo) => {
    await register(page);
    await page.goto("/account");
    const colours = page.getByRole("radiogroup", { name: "Your colour" });
    await expect(colours.getByRole("radio", { name: "Teal", exact: true })).toBeVisible();
    await expect(colours.getByRole("radio", { name: /#/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("seen-account-swatches.png") });
  });
});
