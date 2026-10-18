import { expect, test, type Locator, type Page } from "@playwright/test";
import { card, createProject, register, unique } from "./helpers";

type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
};

/*
 * The task panel's look. In a new project Priority fits as a row of buttons
 * and Status, with "In Progress", does not, so it is a menu. High and In
 * Progress share one colour, so the two picked looks can be held side by side.
 * A phone draws the first column, so a task looked at there sits in Backlog.
 */
async function openTask(page: Page, status = "In Progress") {
  await register(page, "Panel Person");
  const projectId = await createProject(page, unique("Panel"));
  const board: Board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const pick = (property: string, option: string) => {
    const p = board.properties.find((x) => x.name === property)!;
    return [p.id, p.options.find((o) => o.name === option)!.id];
  };
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: {
      title: "Looked at",
      description: "Ships offline first.",
      values: Object.fromEntries([pick("Status", status), pick("Priority", "High")]),
    },
  });
  expect(made.status()).toBe(201);
  const { task } = (await made.json()) as { task: { id: string } };
  await page.request.post(`/api/tasks/${task.id}/checklist`, { data: { text: "One thing" } });
  await page.request.post(`/api/tasks/${task.id}/comments`, { data: { body: "A note" } });
  await page.reload();
  await card(page, "Looked at").click();
  const panel = page.getByTestId("task-panel");
  await expect(panel.getByText("One thing")).toBeVisible();
  await expect(panel.getByText("A note")).toBeVisible();
  return panel;
}

function field(panel: Locator, name: string) {
  return panel.locator(`[data-property="${name}"]`);
}

/** What a picked value is drawn with, read off the element that wears it. */
function lookOf(el: Locator) {
  return el.evaluate((node) => {
    const s = getComputedStyle(node);
    const dots = Array.from(node.querySelectorAll("span")).filter(
      (d) => getComputedStyle(d).borderRadius === "50%" && d.getBoundingClientRect().width < 12,
    );
    return {
      background: s.backgroundColor,
      ring: s.boxShadow,
      colour: s.color,
      weight: s.fontWeight,
      dots: dots.length,
    };
  });
}

/** Where the first words inside a box are drawn. */
function wordsAt(box: Locator) {
  return box.evaluate((node) => {
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) =>
        t.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    const text = walk.nextNode()!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const r = range.getClientRects()[0];
    return { x: r.left, y: r.top };
  });
}

test.describe("The task panel reads as one set of controls", () => {
  test("a picked option looks the same as a button row and as a menu", async ({
    page,
  }, testInfo) => {
    const panel = await openTask(page);
    const button = field(panel, "Priority").getByRole("button", { name: "High" });
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const menu = field(panel, "Status").getByRole("button", { name: /In Progress/ });
    await expect(menu).toHaveAttribute("aria-haspopup", "listbox");

    const asButton = await lookOf(button);
    const asMenu = await lookOf(menu);
    expect(asButton.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(asButton.ring).not.toBe("none");
    expect(asMenu).toEqual(asButton);
    expect(asButton.dots).toBe(1);

    /* In the row, only the picked option wears its dot. */
    const other = await lookOf(field(panel, "Priority").getByRole("button", { name: "Low" }));
    expect(other.dots).toBe(0);
    await panel.screenshot({ path: testInfo.outputPath("seen-panel-values.png") });
  });

  test("clicking the description moves no text", async ({ page }, testInfo) => {
    const panel = await openTask(page);
    const shown = panel.getByTestId("markdown").first();
    await expect(shown).toHaveText("Ships offline first.");
    const before = await wordsAt(shown);

    await shown.click();
    const editor = panel.getByTestId("live-editor");
    await expect(editor).toBeFocused();
    const line = editor.locator(".cm-line").first();
    await expect(line).toHaveText("Ships offline first.");
    const after = await wordsAt(line);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await panel.screenshot({ path: testInfo.outputPath("seen-panel-description.png") });
  });

  test("the checklist and comment actions show on keyboard focus", async ({ page }) => {
    const panel = await openTask(page);
    await page.mouse.move(0, 0);
    const remove = panel.getByRole("button", { name: "Remove One thing" });
    const edit = panel.getByRole("button", { name: "Edit" });
    const del = panel.getByRole("button", { name: "Delete comment" });
    for (const action of [remove, edit, del]) {
      await expect(action).toHaveCSS("opacity", "0");
      /* A key first, so the focus that follows is a keyboard one. */
      await page.keyboard.press("Shift");
      await action.focus();
      await expect(action).toBeFocused();
      await expect(action).toHaveCSS("opacity", "1");
    }
  });

  test("delete is the only red row in the task menu", async ({ page }, testInfo) => {
    const panel = await openTask(page);
    await panel.getByRole("button", { name: "Task menu" }).click();
    const delRow = panel.getByRole("button", { name: "Delete task" });
    await expect(delRow).toBeVisible();
    const rows = delRow.locator("..").locator("button");
    const colours = await rows.evaluateAll((els) =>
      els.map((el) => ({ name: el.textContent?.trim(), colour: getComputedStyle(el).color })),
    );
    expect(colours.map((c) => c.name)).toContain("Archive task");
    const red = colours.find((c) => c.name === "Delete task")!.colour;
    expect(colours.filter((c) => c.colour === red).map((c) => c.name)).toEqual(["Delete task"]);
    /* Three groups, with a line between each. */
    await expect(delRow.locator("..").getByRole("separator")).toHaveCount(2);
    await panel.screenshot({ path: testInfo.outputPath("seen-panel-menu.png") });
  });
});

test.describe("The task panel under a finger", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });

  test("its buttons and rows are about 32px and its text boxes 16px", async ({
    page,
  }, testInfo) => {
    const panel = await openTask(page, "Backlog");
    const height = async (el: Locator) => (await el.boundingBox())!.height;

    expect(await height(field(panel, "Priority").getByRole("button", { name: "High" }))).toBe(32);
    expect(await height(field(panel, "Status").getByRole("button", { name: /Backlog/ }))).toBe(32);
    expect(await height(panel.getByRole("button", { name: "Mark as done" }))).toBe(18);
    expect(await height(panel.getByRole("button", { name: "Task menu" }))).toBe(32);

    /* Shown without a hover, and big enough for a finger. */
    for (const name of ["Remove One thing", "Delete comment"]) {
      const action = panel.getByRole("button", { name });
      await expect(action).toHaveCSS("opacity", "1");
      expect(await height(action)).toBeGreaterThanOrEqual(28);
    }
    await expect(panel.getByRole("button", { name: "Edit" })).toHaveCSS("opacity", "1");

    /* A text box at 16px is one iOS does not zoom into. */
    await expect(panel.getByTestId("comment-box")).toHaveCSS("font-size", "16px");
    await panel.getByRole("button", { name: "Add item" }).click();
    await expect(panel.getByPlaceholder("What has to be true?")).toHaveCSS("font-size", "16px");

    await panel.getByRole("button", { name: "Task menu" }).click();
    const row = panel.getByRole("button", { name: "Delete task" });
    expect(await height(row)).toBeGreaterThanOrEqual(30);
    await page.screenshot({ path: testInfo.outputPath("seen-panel-touch.png") });
  });
});
