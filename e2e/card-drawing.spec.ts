import { expect, test } from "@playwright/test";
import {
  addTask,
  card,
  createProject,
  dragOnto,
  gotoSettings,
  propertyRowOrder,
  register,
  unique,
} from "./helpers";

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

    await gotoSettings(page, projectId, "views");
    await page.getByRole("button", { name: "Edit the default card" }).click();
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
    await page.getByRole("button", { name: "Edit the default card" }).click();
    await expect(
      page.getByTestId("card-off").getByRole("button", { name: "Priority, not on the card" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-card-dragged.png"), fullPage: true });
  });

  test("a chip dragged along its row moves the property everywhere", async ({ page }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Reordered"));
    await addTask(page, "Todo", "Due comes first");

    await gotoSettings(page, projectId, "views");
    await page.getByRole("button", { name: "Edit the default card" }).click();
    const drawing = page.getByTestId("card-drawing");
    await expect(
      drawing.getByText(
        "Drag it along its row to change the order. That order is the one order, so the task panel follows it.",
      ),
    ).toBeVisible();
    const chip = (name: string) => drawing.getByRole("button", { name: new RegExp(`^${name}, `) });

    // The editor sits under the default card on Views, so the footer starts
    // by the bottom edge, where the drag would scroll the page under it.
    await page
      .getByTestId("card-zone-footerL")
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
    await dragOnto(page, chip("Due"), chip("Estimate"), /\/api\/properties\/[0-9a-f-]+$/);
    const footer = await page
      .getByTestId("card-zone-footerL")
      .getByTestId("card-drawn")
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).title));
    expect(footer.indexOf("Due")).toBe(footer.indexOf("Estimate") - 1);
    await page.screenshot({ path: testInfo.outputPath("seen-chip-reordered.png"), fullPage: true });

    // A built-in chip holds its spot: dropped on a property, it writes nothing.
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH") writes.push(r.url());
    });
    const from = (await chip("Checklist").boundingBox())!;
    const onto = (await chip("Due").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 6, from.y + from.height / 2, { steps: 4 });
    await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    expect(
      await page
        .getByTestId("card-zone-footerL")
        .getByTestId("card-drawn")
        .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).title)),
    ).toEqual(footer);

    await gotoSettings(page, projectId, "properties");
    await expect
      .poll(async () => {
        const rows = await propertyRowOrder(page);
        return rows.indexOf("Due") === rows.indexOf("Estimate") - 1;
      })
      .toBe(true);

    await page.goto(`/p/${projectId}`);
    await card(page, "Due comes first").click();
    const panel = page.getByTestId("task-panel");
    await expect(panel.locator("[data-property]").first()).toBeVisible();
    const fields = await panel
      .locator("[data-property]")
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.property));
    expect(fields.indexOf("Due")).toBe(fields.indexOf("Estimate") - 1);
  });
});
