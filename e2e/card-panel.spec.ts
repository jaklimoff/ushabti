import { expect, test } from "@playwright/test";
import { addListView, addTask, card, createProject, dragOnto, register, unique } from "./helpers";

/*
 * The card editor in a panel on the board. One board card on the stand-in
 * task sits above it, and the board behind changes at once too.
 */

test.describe("Card panel", () => {
  test("the Card button arranges the open view's card from the board", async ({
    page,
  }, testInfo) => {
    await register(page);
    await createProject(page, unique("Arranged"));
    await addTask(page, "Todo", "Arranged on the board");

    const boardName = "Board";
    const board = page.getByTestId("view-pill").filter({ hasText: boardName });
    await addListView(page, "Rows");
    await board.click();
    await expect(page.getByTestId("list-view")).toHaveCount(0);

    const key = card(page, "Arranged on the board").getByText(/^[A-Z0-9]+-1$/);
    await expect(key).toBeVisible();

    // The button sits before Sort.
    const tools = page.locator('[data-testid="card-button"], [data-testid="sort-button"]');
    await expect(tools.first()).toHaveAttribute("data-testid", "card-button");

    await page.getByTestId("card-button").click();
    const panel = page.getByTestId("card-panel");
    await expect(panel.getByRole("heading", { name: "Card" })).toBeVisible();
    await expect(panel.getByText(`How a card reads on ${boardName}`)).toBeVisible();
    const note = page.getByTestId("card-panel-note");
    await expect(note).toContainText(
      `${boardName} follows the default card, with List and Rows. Your first change here gives ${boardName} a card of its own.`,
    );
    await expect(note.getByRole("button", { name: "Change the default instead" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-card-panel.png") });

    // The first change forks the view, and the card behind changes at once.
    await panel.getByRole("button", { name: /^Task ID, / }).click();
    await page
      .getByRole("dialog", { name: "Task ID on the card" })
      .getByRole("button", { name: "Take off the card" })
      .click();
    await expect(key).toHaveCount(0);
    await expect(note).toContainText(
      `${boardName} has a card of its own. A change to the default does not reach it.`,
    );
    await page.screenshot({ path: testInfo.outputPath("seen-card-panel-own.png") });

    // One panel at a time.
    await card(page, "Arranged on the board").click();
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(panel).toHaveCount(0);
    await page.getByTestId("card-button").click();
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("task-panel")).toHaveCount(0);

    // Escape puts it away.
    await panel.focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    // Use the default asks in place, and the key comes back.
    await page.getByTestId("card-button").click();
    await note.getByRole("button", { name: "Use the default" }).click();
    await note.getByRole("button", { name: "Yes, use the default" }).click();
    await expect(key).toBeVisible();
    await expect(note).toContainText("follows the default card");

    // The default can be edited from here too, and it names who draws it.
    await note.getByRole("button", { name: "Change the default instead" }).click();
    await expect(note).toContainText(
      `This is the default card. ${boardName}, List and Rows draw it.`,
    );
    await expect(note.getByRole("button", { name: `Back to ${boardName}` })).toBeVisible();

    // The change survives a reload, so it was written.
    await panel.getByRole("button", { name: /^Task ID, / }).click();
    await page
      .getByRole("dialog", { name: "Task ID on the card" })
      .getByRole("button", { name: "Take off the card" })
      .click();
    await expect(key).toHaveCount(0);
    await page.reload();
    await expect(card(page, "Arranged on the board")).toBeVisible();
    await expect(key).toHaveCount(0);
  });

  test("one board card on the stand-in task sits above the drawing", async ({ page }, testInfo) => {
    await register(page);
    await createProject(page, unique("Sampled"));
    await addTask(page, "Todo", "A card behind the panel");

    await page.getByTestId("card-button").click();
    const panel = page.getByTestId("card-panel");
    const sample = panel.getByTestId("card-sample");
    const drawing = panel.getByTestId("card-drawing");
    const zone = (place: string) => panel.getByTestId(`card-zone-${place}`);
    await expect(sample.getByTestId("card")).toHaveCount(1);

    // It is above the drawing and exactly as wide as a card on the board.
    const drawn = (await sample.getByTestId("card").boundingBox())!;
    const behind = (await card(page, "A card behind the panel").boundingBox())!;
    expect(Math.abs(drawn.width - behind.width)).toBeLessThan(1);
    expect(drawn.y + drawn.height).toBeLessThan((await drawing.boundingBox())!.y);

    // Every row that is on the card shows a value on it.
    const rows = await drawing
      .getByTestId("card-drawn")
      .evaluateAll((nodes) =>
        nodes.map((n) => [(n as HTMLElement).dataset.item!, (n as HTMLElement).dataset.place!]),
      );
    const on = rows.filter(([, place]) => place !== "off");
    expect(on.length).toBeGreaterThan(4);
    for (const [id, place] of on) {
      const part =
        place === "edge"
          ? sample.getByTestId("card-edge")
          : id === "_desc"
            ? sample.getByTestId("card-desc")
            : sample.locator(`[data-item="${id}"]`);
      await expect(part.first(), `${id} draws on the card`).toBeVisible();
    }
    await expect(sample.getByTestId("card-title")).toBeVisible();

    // The chips are the board's size: nothing zooms them.
    const zoom = await drawing
      .getByTestId("card-drawn")
      .first()
      .evaluate((el) => getComputedStyle(el).zoom);
    expect(zoom).toBe("1");

    // An assignee and two labels share one line in Header right, which is
    // the wider side of its row.
    const right = zone("headerR");
    await expect(right.getByRole("button", { name: /^Assignee, / })).toBeVisible();
    await expect(right.getByRole("button", { name: /^Labels, / })).toBeVisible();
    const tops = await right
      .getByTestId("card-chip")
      .evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().top)));
    expect(tops.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(6);
    expect((await right.boundingBox())!.width).toBeGreaterThan(
      (await zone("headerL").boundingBox())!.width,
    );
    expect((await zone("footerL").boundingBox())!.width).toBeGreaterThan(
      (await zone("footerR").boundingBox())!.width,
    );

    // Pointing at a chip lights its part of the card.
    const priority = drawing.getByRole("button", { name: "Priority, header left" });
    const priorityId = (await priority.getAttribute("data-item"))!;
    const lit = sample.locator(`[data-item="${priorityId}"]`);
    await priority.hover();
    await expect(lit).toHaveAttribute("data-lit", "");
    await expect(sample).toHaveAttribute("data-lighting", "");
    await page.screenshot({ path: testInfo.outputPath("seen-card-panel-sample.png") });
    await page.mouse.move(0, 0);
    await expect(lit).not.toHaveAttribute("data-lit");

    // A drag in the drawing redraws the card at once.
    await dragOnto(page, priority, zone("footerR"), /\/card-view$/);
    await expect(
      zone("footerR").getByRole("button", { name: "Priority, footer right" }),
    ).toBeVisible();
    await expect(lit).toBeVisible();

    // So does the keyboard drag: Priority goes down to the tray, and off the card.
    await zone("footerR").getByRole("button", { name: "Priority, footer right" }).focus();
    await expect(lit).toHaveAttribute("data-lit", "");
    await page.keyboard.press("Space");
    await expect(zone("body")).toHaveAttribute("data-open", "");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowDown");
    await expect(panel.getByTestId("card-off")).toHaveAttribute("data-over", "");
    await page.keyboard.press("Space");
    await expect(
      panel.getByTestId("card-off").getByRole("button", { name: "Priority, not on the card" }),
    ).toBeVisible();
    await expect(lit).toHaveCount(0);

    // A click opens the chip's menu, and its place redraws the card.
    // A click just after a drop is the drop's own, so it waits that out.
    await page.waitForTimeout(500);
    await panel.getByRole("button", { name: "Priority, not on the card" }).click();
    await page
      .getByRole("dialog", { name: "Priority on the card" })
      .getByRole("button", { name: "Put Priority in the header left" })
      .click();
    await expect(lit).toBeVisible();

    // A chip dragged along its place moves the property, as on Settings.
    const chip = (name: string) => drawing.getByRole("button", { name: new RegExp(`^${name}, `) });
    await dragOnto(page, chip("Due"), chip("Estimate"), /\/api\/properties\/[0-9a-f-]+$/);
    const footer = await zone("footerL")
      .getByTestId("card-drawn")
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).title));
    expect(footer.indexOf("Due")).toBe(footer.indexOf("Estimate") - 1);

    // The List shape redraws it too, and a row under the pointer lights its part.
    await panel
      .getByRole("group", { name: "Arrange the card as" })
      .getByRole("button", { name: "List", exact: true })
      .click();
    const row = panel.getByRole("button", { name: /^Priority on the card/ });
    await row.hover();
    await expect(lit).toHaveAttribute("data-lit", "");
    await row.click();
    await panel.getByRole("button", { name: "Take off the card" }).click();
    await expect(lit).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("seen-card-panel-list.png") });
  });

  test("a list view's editor opens on the List shape, a board view's on the Card", async ({
    page,
  }, testInfo) => {
    await register(page);
    await createProject(page, unique("Shapes"));
    await addListView(page, "Rows");

    const panel = page.getByTestId("card-panel");
    const shape = (name: "Card" | "List") =>
      panel
        .getByRole("group", { name: "Arrange the card as" })
        .getByRole("button", { name, exact: true });

    await page.getByTestId("card-button").click();
    await expect(shape("List")).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByTestId("card-row").first()).toBeVisible();
    await expect(panel.getByTestId("card-drawing")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("seen-card-panel-list-start.png") });

    // The default card is the main board's, so it opens on the card.
    await panel.getByRole("button", { name: "Change the default instead" }).click();
    await expect(shape("Card")).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByTestId("card-drawing")).toBeVisible();

    // A board view opens on the card, and the list is one press away.
    await page.getByTestId("view-pill").filter({ hasText: "Board" }).click();
    await expect(shape("Card")).toHaveAttribute("aria-pressed", "true");
    await shape("List").click();
    await expect(panel.getByTestId("card-row").first()).toBeVisible();
  });
});
