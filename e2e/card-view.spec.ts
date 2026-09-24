import { expect, test } from "@playwright/test";
import {
  addListView,
  addTask,
  card,
  createProject,
  dragOnto,
  gotoSettings,
  register,
  saved,
  unique,
} from "./helpers";

/**
 * The row of the card view page that belongs to one property or built-in part,
 * found by the cell that names it.
 */
function row(page: import("@playwright/test").Page, name: string) {
  return page.getByTestId("card-row").filter({
    has: page.getByRole("button", { name: new RegExp(`^${name} on the card`) }),
  });
}

test.describe("Card view", () => {
  test("moving a property to the footer moves it on the board", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Card"));
    await addTask(page, "Todo", "Card of mine");
    await page.getByRole("button", { name: "Urgent" }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "card");

    const priority = row(page, "Priority");
    await expect(priority).toHaveAttribute("data-place", "headerL");

    await priority.getByRole("button", { name: /^Priority on the card/ }).click();
    await saved(page, () =>
      page.getByRole("button", { name: "Put Priority in the footer left" }).click(),
    );
    await expect(priority).toHaveAttribute("data-place", "footerL");

    // The board draws the same card view, so the change is already there.
    await page.goto(`/p/${projectId}`);
    const chips = card(page, "Card of mine").getByTestId("card-chip");
    await expect(chips.last()).toHaveAttribute("title", "Priority · Urgent");
  });

  test("the edge stripe belongs to one property at a time", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Edge"));
    await addTask(page, "Todo", "Striped");
    await page.getByRole("button", { name: "Urgent" }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "card");

    await row(page, "Priority")
      .getByRole("button", { name: /^Priority on the card/ })
      .click();
    await saved(page, () =>
      page.getByRole("button", { name: "Put Priority in the edge stripe" }).click(),
    );
    await expect(row(page, "Priority")).toHaveAttribute("data-place", "edge");

    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Striped").getByTestId("card-edge")).toBeVisible();

    // Taking the edge takes whoever held it off the card, and says so first.
    await gotoSettings(page, projectId, "card");
    await row(page, "Phase")
      .getByRole("button", { name: /^Phase on the card/ })
      .click();
    await expect(page.getByText("Taking the edge takes Priority off the card.")).toBeVisible();
    await saved(page, () =>
      page.getByRole("button", { name: "Put Phase in the edge stripe" }).click(),
    );
    await expect(row(page, "Phase")).toHaveAttribute("data-place", "edge");
    await expect(row(page, "Priority")).toHaveAttribute("data-place", "off");

    // The task carries no phase, so there is nothing to paint the stripe with.
    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Striped").getByTestId("card-edge")).toHaveCount(0);
  });

  test("the panel wears the colour of the card it opens", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Band"));
    await addTask(page, "Todo", "Coloured");
    await page.getByRole("button", { name: "Urgent" }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "card");
    await row(page, "Priority")
      .getByRole("button", { name: /^Priority on the card/ })
      .click();
    await saved(page, () =>
      page.getByRole("button", { name: "Put Priority in the edge stripe" }).click(),
    );

    await page.goto(`/p/${projectId}`);
    const stripe = card(page, "Coloured").getByTestId("card-edge");
    const colour = await stripe.evaluate((el) => getComputedStyle(el).backgroundColor);

    await card(page, "Coloured").click();
    await expect(page.getByTestId("task-panel")).toBeVisible();
    const band = page.getByTestId("panel-accent");
    expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(colour);

    // The priority used to be said again at the top of the panel. The panel
    // holds it as a property, so it is said once.
    await expect(page.getByTestId("task-panel").getByText("Urgent").first()).toBeVisible();
  });

  test("a filled row wears its colour behind the words", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Fill"));
    await addTask(page, "Todo", "Labelled");
    await page.getByRole("button", { name: "Urgent" }).click();
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "card");
    await row(page, "Priority")
      .getByRole("button", { name: /^Priority on the card/ })
      .click();
    await saved(page, () => page.getByRole("button", { name: "Filled" }).click());

    await page.goto(`/p/${projectId}`);
    const chip = card(page, "Labelled").getByTestId("card-chip").filter({ hasText: "Urgent" });
    const paint = await chip.evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(paint.background).toBe("rgb(224, 87, 77)");
    expect(paint.color).not.toBe(paint.background);
  });

  test("a date has no colours of its own, so the edge is closed to it", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Dates"));
    await gotoSettings(page, projectId, "card");

    await row(page, "Due")
      .getByRole("button", { name: /^Due on the card/ })
      .click();
    await expect(page.getByText("No colours of its own, so the edge stripe is out.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Put Due in the edge stripe" })).toBeDisabled();
  });

  test("the description joins the card, and Reset takes it back off", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Desc"));
    await addTask(page, "Todo", "Has a description");
    await page.getByText("Add a description…").click();
    const body = page.getByPlaceholder("Write in markdown…");
    await body.fill("A longer account of it.");
    await saved(page, () => body.blur());
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "card");
    await row(page, "Description")
      .getByRole("button", { name: /^Description on the card/ })
      .click();
    await saved(page, () =>
      page.getByRole("button", { name: "Put Description in the body" }).click(),
    );

    await page.goto(`/p/${projectId}`);
    await expect(card(page, "Has a description").getByTestId("card-desc")).toHaveText(
      "A longer account of it.",
    );

    await gotoSettings(page, projectId, "card");
    // The card view is everybody's, so a reset asks first and says how much moves.
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(
      page.getByText("Reset the card view for everyone? 1 row goes back to the default."),
    ).toBeVisible();
    await expect(row(page, "Description")).not.toHaveAttribute("data-place", "off");
    await saved(page, () => page.getByRole("button", { name: "Yes, reset" }).click());
    await expect(row(page, "Description")).toHaveAttribute("data-place", "off");
    // Now there is nothing to reset.
    await expect(page.getByRole("button", { name: "Reset to default" })).toBeDisabled();
  });

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

  test("the title cannot be moved and cannot come off", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Title"));
    await gotoSettings(page, projectId, "card");

    await expect(row(page, "Title")).toHaveAttribute("data-place", "title");
    await expect(page.getByRole("button", { name: /^Title on the card/ })).toBeDisabled();
  });

  test("a row taken off the card comes back from the properties page", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Both"));
    await gotoSettings(page, projectId, "card");

    await row(page, "Due")
      .getByRole("button", { name: /^Due on the card/ })
      .click();
    await saved(page, () => page.getByRole("button", { name: "Take off the card" }).click());
    await expect(row(page, "Due")).toHaveAttribute("data-place", "off");

    await gotoSettings(page, projectId, "properties");
    await expect(page.getByRole("button", { name: "Show Due on the card" })).toBeVisible();
    await saved(page, () => page.getByRole("button", { name: "Show Due on the card" }).click());

    await gotoSettings(page, projectId, "card");
    await expect(row(page, "Due")).toHaveAttribute("data-place", "footerL");
  });
});
