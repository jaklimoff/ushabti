import { expect, test } from "@playwright/test";
import { addTask, createProject, dragOnto, gotoSettings, register, unique } from "./helpers";

/*
 * The drag on the big card of the card view page. What each drop writes is a
 * component test, in `src/components/settings/CardViewPanel.test.tsx`; this
 * one holds the real pointer, the keyboard and a reload.
 */

test.describe("Card drawing", () => {
  test("a chip dragged on the big card moves to another place", async ({ page }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Dragged"));
    await addTask(page, "Todo", "Arranged by drags");

    await gotoSettings(page, projectId, "card");
    const drawing = page.getByTestId("card-drawing");
    await expect(drawing.getByText("Drag a chip to another place, or off the card.")).toBeVisible();
    const zone = (place: string) => page.getByTestId(`card-zone-${place}`);

    await dragOnto(
      page,
      drawing.getByRole("button", { name: "Priority, header left" }),
      zone("footerR"),
      /\/card-view$/,
    );
    await expect(
      zone("footerR").getByRole("button", { name: "Priority, footer right" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Priority on the card" })).toHaveCount(0);

    // A held date shows the edge closed.
    const due = drawing.getByRole("button", { name: /^Due, / });
    const from = (await due.boundingBox())!;
    const edge = (await zone("edge").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 6, from.y + from.height / 2 + 6, { steps: 4 });
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2, { steps: 20 });
    await expect(zone("edge")).toHaveAttribute("data-closed", "");
    await page.screenshot({ path: testInfo.outputPath("seen-edge-closed.png") });
    await page.mouse.up();
    await expect(zone("edge")).not.toHaveAttribute("data-closed");
    await expect(zone("edge").getByRole("button", { name: /^Due, / })).toHaveCount(0);

    // The keyboard takes Priority down to the tray.
    await zone("footerR").getByRole("button", { name: "Priority, footer right" }).focus();
    await page.keyboard.press("Space");
    await expect(zone("body")).toHaveAttribute("data-open", "");
    // dnd-kit hears the arrows from a timer after the lift.
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("card-off")).toHaveAttribute("data-over", "");
    await page.keyboard.press("Space");
    await expect(
      page.getByTestId("card-off").getByRole("button", { name: "Priority, not on the card" }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByTestId("card-off").getByRole("button", { name: "Priority, not on the card" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-card-dragged.png"), fullPage: true });
  });
});
