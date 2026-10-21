import { expect, test } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

/*
 * The "⋯" beside the open view's pill. Renaming, grouping and deleting a view
 * used to be a trip to Settings; each is now one click from the view, and
 * survives a reload because it is the same write Settings makes.
 */

test.describe("View menu", () => {
  test("renames the open view, regroups it and deletes it from the strip", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Menu"));
    // A second board, which a new project no longer has.
    const board = (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
      properties: { id: string; name: string }[];
    };
    const priority = board.properties.find((p) => p.name === "Priority")!;
    const made = await page.request.post(`/api/projects/${projectId}/views`, {
      data: { name: "Priorities", kind: "board", groupById: priority.id },
    });
    expect(made.status()).toBe(201);
    await page.reload();
    const pill = (name: string) => page.getByTestId("view-pill").filter({ hasText: name });

    await pill("Priorities").click();
    await expect(pill("Priorities")).toHaveAttribute("aria-current", "true");
    await pill("Priorities").hover();
    await page.getByRole("button", { name: "More for Priorities" }).click();
    const menu = page.getByRole("menu", { name: "More for Priorities" });
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Rename",
      "Card",
      "Copy link",
      "Make main",
      "Delete",
    ]);
    await expect(menu.getByRole("group", { name: "Columns by" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-view-menu.png") });

    // Rename: the pill becomes a box, and Enter saves.
    await menu.getByRole("menuitem", { name: "Rename" }).click();
    const box = page.getByRole("textbox", { name: "Name of the view Priorities" });
    await expect(box).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("seen-view-rename.png") });
    await box.fill("Stages");
    await page.keyboard.press("Enter");
    await expect(pill("Stages")).toBeFocused();

    // Columns by: the grouping changes in place.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    const renamed = page.getByRole("menu", { name: "More for Stages" });
    await renamed.getByRole("menuitemradio", { name: "Status" }).click();
    await expect(renamed).toHaveCount(0);
    await expect(page.getByTestId("column-name").filter({ hasText: /^Todo$/i })).toBeVisible();

    await page.reload();
    await expect(pill("Stages")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("column-name").filter({ hasText: /^Todo$/i })).toBeVisible();

    // Delete asks first, in the menu.
    await pill("Stages").hover();
    await page.getByRole("button", { name: "More for Stages" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("alertdialog")).toHaveAccessibleName(
      "Delete the view Stages? The tasks stay; only this way of looking at them goes.",
    );
    await page.screenshot({ path: testInfo.outputPath("seen-view-delete.png") });
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await expect(pill("Stages")).toHaveCount(0);

    await page.reload();
    await expect(pill("Board")).toBeVisible();
    await expect(pill("Stages")).toHaveCount(0);
  });
});
