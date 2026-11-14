import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, overflow, register, unique } from "./helpers";

/*
 * Settings → Card copies another project's look into this one. What matches
 * and what the words say is `src/lib/__tests__/look.test.ts`; the write and
 * the refusals are `look-route.test.ts`. This is the page and the press.
 */

type Board = {
  properties: {
    id: string;
    name: string;
    type: string;
    options: { id: string; name: string; color: string }[];
  }[];
  cardView: { rows: Record<string, { place: string; mode: string }> };
};

async function read(page: Page, projectId: string): Promise<Board> {
  const res = await page.request.get(`/api/projects/${projectId}/board`);
  expect(res.ok()).toBe(true);
  return res.json();
}

/** Two projects of one person: the other one moves its key and paints an option. */
async function twoProjects(page: Page) {
  await register(page);
  const there = unique("Mnemes");
  const thereId = await createProject(page, there);
  const hereId = await createProject(page, unique("Here"));

  const theirs = await read(page, thereId);
  await page.request.patch(`/api/projects/${thereId}/card-view`, {
    data: {
      cardView: { rows: { ...theirs.cardView.rows, _key: { place: "footerR", mode: "boxed" } } },
    },
  });
  const select = theirs.properties.find((p) => p.type === "select" && p.options.length > 0)!;
  const painted = await page.request.patch(`/api/options/${select.options[0].id}`, {
    data: { color: "#123456" },
  });
  expect(painted.ok()).toBe(true);

  /* A property only this project has, so the line names what stays. */
  const made = await page.request.post(`/api/projects/${hereId}/properties`, {
    data: { name: "Only here", type: "text" },
  });
  expect(made.status()).toBe(201);
  return { there, thereId, hereId, select };
}

test.describe("Copy the look of another project", () => {
  test("Copy from… asks with the counts, and Yes, copy draws the new card", async ({
    page,
  }, testInfo) => {
    const { there, hereId, select } = await twoProjects(page);
    await gotoSettings(page, hereId, "card");

    const key = page.locator('[data-testid="card-drawn"][data-item="_key"]');
    await expect(key).toHaveAttribute("data-place", "headerL");

    await expect(page.getByRole("heading", { name: "Other projects" })).toBeVisible();
    await expect(
      page.getByText("A copy, never a link. A later change in one project reaches no other"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Copy from…" }).click();

    const ask = page.getByTestId("copy-look");
    await expect(ask.getByRole("checkbox", { name: "Card layout" })).toBeChecked();
    await expect(ask.getByRole("checkbox", { name: "Icons and colours" })).toBeChecked();
    const from = ask.getByRole("radiogroup", { name: "From" });
    const line = from.getByTestId("look-line").filter({ hasText: there });
    await expect(line).toContainText(/\d+ of \d+ properties · \d+ icons and colours\./);
    await expect(line).toContainText("Only here here stays as it is.");

    const yes = ask.getByRole("button", { name: "Yes, copy" });
    await expect(yes).toBeDisabled();
    await expect(ask).toContainText("Pick a project to copy from.");

    await from.getByRole("radio", { name: new RegExp(there) }).check();
    await expect(ask).toContainText(
      new RegExp(
        `Copy the look of ${there}\\? This project's default card is replaced, and \\d+ options and checkboxes take its icon and colour\\. Tasks do not change\\.`,
      ),
    );

    await ask.getByRole("checkbox", { name: "Card layout" }).uncheck();
    await expect(ask).toContainText(
      new RegExp(`Copy the look of ${there}\\? \\d+ options and checkboxes take its icon`),
    );
    await expect(line).not.toContainText("properties");
    await ask.getByRole("checkbox", { name: "Icons and colours" }).uncheck();
    await expect(ask).toContainText("Pick what to copy.");
    await expect(yes).toBeDisabled();
    await ask.getByRole("checkbox", { name: "Card layout" }).check();
    await ask.getByRole("checkbox", { name: "Icons and colours" }).check();
    await page.screenshot({ path: testInfo.outputPath("seen-copy-look.png"), fullPage: true });

    await yes.click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy from…" })).toBeVisible();
    /* The editor draws the copied card with no reload. */
    await expect(key).toHaveAttribute("data-place", "footerR");

    const after = await read(page, hereId);
    const mine = after.properties.find((p) => p.name === select.name)!;
    expect(mine.options.find((o) => o.name === select.options[0].name)!.color).toBe("#123456");
    const onlyHere = after.properties.find((p) => p.name === "Only here")!;
    expect(after.cardView.rows[onlyHere.id].place).not.toBe("edge");
  });

  test("Cancel and Escape put the row back and write nothing", async ({ page }) => {
    const { there, hereId } = await twoProjects(page);
    await gotoSettings(page, hereId, "card");
    const before = (await read(page, hereId)).cardView;

    await page.getByRole("button", { name: "Copy from…" }).click();
    const ask = page.getByTestId("copy-look");
    await ask.getByRole("radio", { name: new RegExp(there) }).check();
    await page.keyboard.press("Escape");
    await expect(ask).toHaveCount(0);

    await page.getByRole("button", { name: "Copy from…" }).click();
    await ask.getByRole("radio", { name: new RegExp(there) }).check();
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);

    expect((await read(page, hereId)).cardView).toEqual(before);
  });

  test("a view's card and a person with one project have no such row", async ({ page }) => {
    await register(page);
    const only = await createProject(page, unique("Alone"));
    await gotoSettings(page, only, "card");
    await expect(page.getByTestId("card-drawing")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy from…" })).toHaveCount(0);

    await createProject(page, unique("Second"));
    await gotoSettings(page, only, "card");
    await expect(page.getByRole("button", { name: "Copy from…" })).toBeVisible();
    await page.getByRole("navigation", { name: "Whose card" }).getByRole("link").nth(1).click();
    await expect(page.getByTestId("view-fork")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy from…" })).toHaveCount(0);
  });

  test("at 390 px the question fits and nothing scrolls sideways", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { there, hereId } = await twoProjects(page);
    await gotoSettings(page, hereId, "card");
    await page.getByRole("button", { name: "Copy from…" }).click();
    const ask = page.getByTestId("copy-look");
    await ask.getByRole("radio", { name: new RegExp(there) }).check();
    await expect(ask.getByRole("button", { name: "Yes, copy" })).toBeEnabled();

    const label = ask.getByText("From", { exact: true });
    const list = ask.getByRole("radiogroup", { name: "From" });
    const [l, r] = [await label.boundingBox(), await list.boundingBox()];
    expect(l!.y + l!.height).toBeLessThanOrEqual(r!.y);
    expect(await overflow(page)).toBe(0);
    await ask.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("seen-copy-look-phone.png"),
      fullPage: true,
    });
  });
});
