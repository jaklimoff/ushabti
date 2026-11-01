import { expect, test, type Locator } from "@playwright/test";
import {
  addListView,
  addTask,
  card,
  column,
  createProject,
  listRow,
  register,
  unique,
} from "./helpers";

/*
 * A new project's Status and Priority options carry icons, so a fresh board
 * shows them wherever it used to show only a dot: the card, the column head,
 * the picker and a list row. Which chip carries which part is a unit test in
 * `src/lib/__tests__/card-view.test.ts`; this one holds what is drawn.
 */

type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
};

const URGENT = "rgb(224, 87, 77)";

function icon(holder: Locator, name: string) {
  return holder.locator(`svg[data-icon="${name}"]`);
}

test.describe("An option's icon", () => {
  test("shows on the card, the column head, the picker and a list row", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Icons"));
    await addTask(page, "Todo", "Wears an icon");

    // The picker: the picked option, the current value and every option.
    const panel = page.getByTestId("task-panel");
    const priority = panel.locator('[data-property="Priority"]');
    await priority.getByRole("button", { name: "Urgent" }).click();
    await expect(icon(priority.getByRole("button", { name: "Urgent" }), "OctagonAlert")).toHaveCSS(
      "color",
      URGENT,
    );
    const status = panel.locator('[data-property="Status"]');
    const trigger = status.getByRole("button", { name: /Todo/ });
    await expect(icon(trigger, "Circle")).toBeVisible();
    await trigger.click();
    const menu = status.getByRole("listbox");
    await expect(
      icon(menu.getByRole("option", { name: /In Progress/ }), "CircleDot"),
    ).toBeVisible();
    await expect(icon(menu.getByRole("option", { name: /Done/ }), "CheckCircle")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-picker.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Close task" }).click();

    // The card: Priority is a colour chip, so the icon alone, first in its place.
    const chips = card(page, "Wears an icon").getByTestId("card-chip");
    const lead = chips.first();
    await expect(lead).toHaveAttribute("title", "Priority · Urgent");
    await expect(icon(lead, "OctagonAlert")).toHaveCSS("color", URGENT);
    await expect(lead).toHaveText("");

    // The column heads, open and folded.
    await expect(icon(column(page, "Todo"), "Circle")).toBeVisible();
    await expect(icon(page.getByTestId("column-strip").first(), "CirclePause")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-board.png") });

    // A list row shows the same icon.
    await addListView(page, "Rows");
    await expect(icon(listRow(page, "Wears an icon"), "OctagonAlert")).toHaveCSS("color", URGENT);
    await page.screenshot({ path: testInfo.outputPath("seen-list.png") });

    // An option without an icon draws its swatch, as before.
    const board: Board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const urgent = board.properties
      .find((p) => p.name === "Priority")!
      .options.find((o) => o.name === "Urgent")!;
    const cleared = await page.request.patch(`/api/options/${urgent.id}`, {
      data: { icon: null },
    });
    expect(cleared.ok()).toBe(true);
    await page.getByTestId("view-pill").filter({ hasText: "Board" }).click();
    const plain = card(page, "Wears an icon").getByTestId("card-chip").first();
    await expect(plain).toHaveAttribute("title", "Priority · Urgent");
    await expect(plain.locator("svg")).toHaveCount(0);
    await expect(plain.locator("span").first()).toHaveCSS("background-color", URGENT);
  });
});
