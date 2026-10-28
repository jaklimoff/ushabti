import { expect, test } from "@playwright/test";
import {
  addListView,
  addTask,
  card,
  createProject,
  dragOnto,
  gotoSettings,
  register,
  unique,
} from "./helpers";

/*
 * What the card view page does to a card is a component test, in
 * `src/components/settings/CardViewPanel.test.tsx`. The one drag in
 * Properties stays here: it moves the card, the panel and the list across
 * a new page each.
 */

test.describe("Card view", () => {
  test("a property dragged in Settings moves on the card, in the panel and in the list", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Order"));
    // A second select, which a new project no longer has. It is made last, so
    // it sits after Estimate.
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Phase", type: "select", options: ["PoC", "MVP"] },
    });
    expect(made.status()).toBe(201);
    await page.reload();
    await addTask(page, "Todo", "Two in the footer");
    await page.locator('[data-property="Phase"]').getByRole("button", { name: "MVP" }).click();
    await page
      .locator('[data-property="Estimate"]')
      .getByRole("button", { name: "M", exact: true })
      .click();
    await page.getByRole("button", { name: "Close task" }).click();

    // Phase and Estimate share the footer, in the order of the properties.
    const footer = card(page, "Two in the footer").locator(
      '[data-testid="card-chip"][title^="Phase"], [data-testid="card-chip"][title^="Estimate"]',
    );
    await expect(footer).toHaveCount(2);
    const tips = async () => footer.evaluateAll((els) => els.map((e) => e.getAttribute("title")));
    expect(await tips()).toEqual(["Estimate · M", "Phase · MVP"]);

    // The card view has no order of its own to change.
    await gotoSettings(page, projectId, "views");
    await page.getByRole("button", { name: "Edit the default card" }).click();
    await expect(page.getByRole("button", { name: /^Move .* (up|down)$/ })).toHaveCount(0);

    // One drag in Properties is the one order.
    await gotoSettings(page, projectId);
    // Status is a tall row now, so Phase starts by the bottom edge, where
    // the drag would scroll the page under the pointer.
    await page
      .getByLabel("Name of the Estimate property")
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
    await dragOnto(
      page,
      page.getByRole("button", { name: "Move Phase" }),
      page.getByLabel("Name of the Estimate property"),
      /^\/api\/properties\/[0-9a-f-]+$/,
    );

    await page.goto(`/p/${projectId}`);
    await expect(footer).toHaveCount(2);
    expect(await tips()).toEqual(["Phase · MVP", "Estimate · M"]);

    await card(page, "Two in the footer").click();
    const fields = await page
      .locator("[data-property]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-property")));
    expect(fields.indexOf("Phase")).toBeLessThan(fields.indexOf("Estimate"));
    await page.getByRole("button", { name: "Close task" }).click();

    // A list draws the same columns in the same order, after the key and the title.
    await addListView(page, "Rows");
    const heads = (await page.getByTestId("list-head-name").allInnerTexts()).map((t) =>
      t.trim().toUpperCase(),
    );
    expect(heads.slice(0, 2)).toEqual(["TASK ID", "TITLE"]);
    expect(heads.indexOf("PHASE")).toBeLessThan(heads.indexOf("ESTIMATE"));
  });

  test("a chip clicked on the big card changes how it reads and where it sits", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Drawn"));
    await addTask(page, "Todo", "Arranged by clicks");

    await gotoSettings(page, projectId, "views");
    await page.getByRole("button", { name: "Edit the default card" }).click();
    const drawing = page.getByTestId("card-drawing");
    await expect(drawing.getByText("Title · always here")).toBeVisible();
    await expect(
      page.getByTestId("card-zone-headerL").getByRole("button", { name: "Priority, header left" }),
    ).toBeVisible();

    await drawing.getByRole("button", { name: "Priority, header left" }).click();
    const pop = page.getByRole("dialog", { name: "Priority on the card" });
    await pop.getByRole("button", { name: "Filled" }).click();
    await expect(pop.getByRole("button", { name: "Filled" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(pop.getByRole("switch", { name: "Colour the card's edge" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-chip-popover.png") });

    // An off chip goes back in from its own popover.
    await page.keyboard.press("Escape");
    await drawing.getByRole("button", { name: "Description, not on the card" }).click();
    await page
      .getByRole("dialog", { name: "Description on the card" })
      .getByRole("button", { name: "Put Description in the body" })
      .click();
    await expect(
      page.getByTestId("card-zone-body").getByRole("button", { name: "Description, body" }),
    ).toBeVisible();

    // What was saved is what the page draws again after a reload.
    await page.reload();
    await page.getByRole("button", { name: "Edit the default card" }).click();
    await expect(
      page.getByTestId("card-zone-body").getByRole("button", { name: "Description, body" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-card-drawing.png"), fullPage: true });

    // The list is the same editor as rows.
    await page
      .getByRole("group", { name: "Arrange the card as" })
      .getByRole("button", { name: "List", exact: true })
      .click();
    await expect(
      page
        .getByTestId("card-row")
        .filter({ has: page.getByRole("button", { name: /^Description on the card/ }) }),
    ).toHaveAttribute("data-place", "body");
  });
});
