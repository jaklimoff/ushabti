import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, overflow, register, unique } from "./helpers";

/*
 * Settings → Card applies this project's look to other projects. The words
 * are `src/lib/__tests__/look.test.ts`; the write across projects and the
 * refusals are `look-route.test.ts`. This is the page and the press.
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

/** Three projects of one person: this one moves its key and paints an option. */
async function threeProjects(page: Page) {
  await register(page);
  const one = unique("Website");
  const oneId = await createProject(page, one);
  const two = unique("Docs");
  const twoId = await createProject(page, two);
  const hereId = await createProject(page, unique("Here"));

  const mine = await read(page, hereId);
  await page.request.patch(`/api/projects/${hereId}/card-view`, {
    data: {
      cardView: { rows: { ...mine.cardView.rows, _key: { place: "footerR", mode: "boxed" } } },
    },
  });
  const select = mine.properties.find((p) => p.type === "select" && p.options.length > 0)!;
  const painted = await page.request.patch(`/api/options/${select.options[0].id}`, {
    data: { color: "#123456" },
  });
  expect(painted.ok()).toBe(true);

  /* Only this project has Sprint, and Size is a date in Website. */
  for (const [projectId, name, type] of [
    [hereId, "Sprint", "text"],
    [hereId, "Size", "number"],
    [oneId, "Size", "date"],
  ]) {
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name, type },
    });
    expect(made.status()).toBe(201);
  }
  return { one, oneId, two, twoId, hereId, select };
}

test.describe("Apply this project's look to other projects", () => {
  test("Apply to… asks with every project ticked, and Yes writes them all", async ({
    page,
  }, testInfo) => {
    const { one, oneId, two, twoId, hereId, select } = await threeProjects(page);
    await gotoSettings(page, hereId, "card");
    const before = await read(page, hereId);

    await expect(
      page.getByText("The projects you pick take this project's card layout, icons and colours."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Apply to…" }).click();

    const ask = page.getByTestId("apply-look");
    await expect(ask.getByRole("checkbox", { name: "Card layout", exact: true })).toBeChecked();
    await expect(
      ask.getByRole("checkbox", { name: "Icons and colours", exact: true }),
    ).toBeChecked();
    const list = ask.getByRole("group", { name: "To" });
    await expect(list.getByTestId("apply-line")).toHaveCount(2);
    await expect(list.getByRole("checkbox", { name: new RegExp(one) })).toBeChecked();
    await expect(list.getByRole("checkbox", { name: new RegExp(two) })).toBeChecked();
    const first = list.getByTestId("apply-line").filter({ hasText: one });
    await expect(first).toContainText(/\d+ of \d+ properties · \d+ icons and colours\./);
    await expect(first).toContainText("No Sprint there. Size is a date there.");
    await expect(list.getByTestId("apply-line").filter({ hasText: two })).toContainText(
      "No Sprint there. No Size there.",
    );

    await expect(ask).toContainText(
      /Apply to 2 projects\? Each one's default card is replaced, and \d+ options and checkboxes take this project's icon and colour\. Tasks do not change\./,
    );
    await expect(ask.getByRole("button", { name: "Yes, apply to 2" })).toBeEnabled();

    await list.getByRole("checkbox", { name: new RegExp(two) }).uncheck();
    await expect(ask).toContainText(new RegExp(`Apply to ${one}\\? Its default card is replaced`));
    await expect(ask.getByRole("button", { name: "Yes, apply", exact: true })).toBeEnabled();
    await list.getByRole("checkbox", { name: new RegExp(one) }).uncheck();
    await expect(ask).toContainText("Pick a project to apply to.");
    await expect(ask.getByRole("button", { name: /Yes, apply/ })).toBeDisabled();
    await list.getByRole("checkbox", { name: new RegExp(one) }).check();
    await list.getByRole("checkbox", { name: new RegExp(two) }).check();

    await ask.getByRole("checkbox", { name: "Card layout", exact: true }).uncheck();
    await ask.getByRole("checkbox", { name: "Icons and colours", exact: true }).uncheck();
    await expect(ask).toContainText("Pick what to apply.");
    await expect(ask.getByRole("button", { name: /Yes, apply/ })).toBeDisabled();
    await ask.getByRole("checkbox", { name: "Card layout", exact: true }).check();
    await ask.getByRole("checkbox", { name: "Icons and colours", exact: true }).check();

    /* One row is the question at a time. */
    await page.getByRole("button", { name: "Copy from…" }).click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByTestId("copy-look")).toBeVisible();
    await page.getByRole("button", { name: "Apply to…" }).click();
    await expect(page.getByTestId("copy-look")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("seen-apply-look.png"), fullPage: true });

    await ask.getByRole("button", { name: "Yes, apply to 2" }).click();
    await expect(ask).toHaveCount(0);
    /* In the person's Home order, where the newest project sits first. */
    await expect(page.getByTestId("look-applied")).toHaveText(
      `Applied just now to ${two} and ${one}.`,
    );
    await page.screenshot({ path: testInfo.outputPath("seen-apply-done.png"), fullPage: true });

    /* This project is as it was. */
    const after = await read(page, hereId);
    expect(after.cardView).toEqual(before.cardView);
    expect(after.properties).toEqual(before.properties);

    for (const id of [oneId, twoId]) {
      const theirs = await read(page, id);
      expect(theirs.cardView.rows._key.place).toBe("footerR");
      const p = theirs.properties.find((x) => x.name === select.name)!;
      expect(p.options.find((o) => o.name === select.options[0].name)!.color).toBe("#123456");
    }

    /* The new card, drawn in one of them. */
    await gotoSettings(page, oneId, "card");
    await expect(page.locator('[data-testid="card-drawn"][data-item="_key"]')).toHaveAttribute(
      "data-place",
      "footerR",
    );
  });

  test("Cancel and Escape put the row back and write nothing", async ({ page }) => {
    const { oneId, hereId } = await threeProjects(page);
    await gotoSettings(page, hereId, "card");
    const before = (await read(page, oneId)).cardView;

    await page.getByRole("button", { name: "Apply to…" }).click();
    const ask = page.getByTestId("apply-look");
    await expect(ask).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ask).toHaveCount(0);

    await page.getByRole("button", { name: "Apply to…" }).click();
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByTestId("look-applied")).toHaveCount(0);

    expect((await read(page, oneId)).cardView).toEqual(before);
  });

  test("at 390 px the question fits and nothing scrolls sideways", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { hereId } = await threeProjects(page);
    await gotoSettings(page, hereId, "card");
    await page.getByRole("button", { name: "Apply to…" }).click();
    const ask = page.getByTestId("apply-look");
    await expect(ask.getByRole("button", { name: "Yes, apply to 2" })).toBeEnabled();

    const label = ask.getByText("To", { exact: true });
    const list = ask.getByRole("group", { name: "To" });
    const [l, r] = [await label.boundingBox(), await list.boundingBox()];
    expect(l!.y + l!.height).toBeLessThanOrEqual(r!.y);
    expect(await overflow(page)).toBe(0);
    await ask.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("seen-apply-look-phone.png"),
      fullPage: true,
    });
  });
});
