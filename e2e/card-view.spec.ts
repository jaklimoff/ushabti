import { expect, test } from "@playwright/test";
import { addTask, card, createProject, gotoSettings, register, saved, unique } from "./helpers";

/**
 * The row of the card view page that belongs to one property or built-in part.
 * The row opens with its move buttons, so it is found by the cell that names it.
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
    await saved(page, () => page.getByRole("button", { name: "Reset to default" }).click());
    await expect(row(page, "Description")).toHaveAttribute("data-place", "off");
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
