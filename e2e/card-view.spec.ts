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
    expect(await tips()).toEqual(["Phase · MVP", "Estimate · M"]);

    // The card view has no order of its own to change.
    await gotoSettings(page, projectId, "card");
    await expect(page.getByRole("button", { name: /^Move .* (up|down)$/ })).toHaveCount(0);

    // One drag in Properties is the one order.
    await gotoSettings(page, projectId);
    await dragOnto(
      page,
      page.getByRole("button", { name: "Move Estimate" }),
      page.getByLabel("Name of the Phase property"),
      /^\/api\/properties\/[0-9a-f-]+$/,
    );

    await page.goto(`/p/${projectId}`);
    await expect(footer).toHaveCount(2);
    expect(await tips()).toEqual(["Estimate · M", "Phase · MVP"]);

    await card(page, "Two in the footer").click();
    const fields = await page
      .locator("[data-property]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-property")));
    expect(fields.indexOf("Estimate")).toBeLessThan(fields.indexOf("Phase"));
    await page.getByRole("button", { name: "Close task" }).click();

    // A list draws the same columns in the same order, after the key and the title.
    await addListView(page, "Rows");
    const heads = (await page.getByTestId("list-head-name").allInnerTexts()).map((t) =>
      t.trim().toUpperCase(),
    );
    expect(heads.slice(0, 2)).toEqual(["TASK ID", "TITLE"]);
    expect(heads.indexOf("ESTIMATE")).toBeLessThan(heads.indexOf("PHASE"));
  });
});
