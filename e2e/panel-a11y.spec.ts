import { expect, test } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

/*
 * The view strip, read by a screen reader. The task panel's focus, roles and
 * names are `src/components/board/PanelA11y.test.tsx`.
 */
test.describe("The panel and the view strip work without a mouse", () => {
  test("the view strip names the view it is on", { tag: "@smoke" }, async ({ page }) => {
    await register(page);
    await createProject(page, unique("Pills"));

    const pills = page.getByTestId("view-pill");
    const active = pills.and(page.locator('[aria-current="true"]'));
    await expect(active).toHaveCount(1);
    const name = ((await active.textContent()) ?? "").trim();
    await expect(active).toHaveAttribute("title", name);
    // The strip has no keyboard drag, so it does not offer one.
    await expect(active).not.toHaveAttribute("aria-roledescription", /./);
    await expect(active).not.toHaveAttribute("aria-describedby", /./);

    // The chips that pick the columns of a new view say which one is chosen.
    await page.getByRole("button", { name: "New view" }).click();
    const columnsBy = page.getByRole("group", { name: "Columns by" });
    const chips = columnsBy.getByRole("button");
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(chips.first()).toHaveAttribute("aria-pressed", "false");
  });
});
