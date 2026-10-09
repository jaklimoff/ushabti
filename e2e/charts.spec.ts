import { expect, test, type Page } from "@playwright/test";
import { addTask, createProject, register, settles, unique } from "./helpers";

/*
 * A chart on Home counts the tasks that entered one column a day. This walks
 * it once: pick in place, see the bars, delete in place. What it counts is
 * unit and route tested.
 */

async function pick(page: Page, label: string, option: string | RegExp) {
  const picker = page.getByTestId("chart-picker");
  await picker.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
  await expect(picker.getByRole("combobox", { name: label })).toContainText(option);
}

/*
 * Every bar lies inside the chart's box, and an empty day is a hairline. The
 * chart's bar once shared a class with the top bar and ran across the next card.
 */
async function barsInside(page: Page) {
  const chart = page.getByTestId("chart");
  const box = await chart.boundingBox();
  if (!box) throw new Error("the chart has no box");
  const bars = await chart.getByTestId("chart-bar").evaluateAll((slots) =>
    slots.map((slot) => {
      const r = slot.getBoundingClientRect();
      const fill = slot.firstElementChild!.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, fill: fill.height };
    }),
  );
  expect(bars).toHaveLength(30);
  for (const b of bars) {
    expect(b.left).toBeGreaterThanOrEqual(box.x);
    expect(b.right).toBeLessThanOrEqual(box.x + box.width);
    expect(b.top).toBeGreaterThanOrEqual(box.y);
    expect(b.bottom).toBeLessThanOrEqual(box.y + box.height);
  }
  // The first day is a month before the project existed, so it counts nothing.
  expect(bars[0].fill).toBeLessThanOrEqual(2);
  expect(bars[29].fill).toBeGreaterThan(40);
}

test("a chart added on Home shows the tasks that entered a column today", async ({ page }) => {
  await register(page, "Chart Person");
  const name = unique("Pace");
  await createProject(page, name);
  await addTask(page, "Todo", "First in Todo");
  await addTask(page, "Todo", "Second in Todo");
  await addTask(page, "Backlog", "Not in Todo");

  await page.goto("/projects");
  await page.getByTestId("chart-new").click();
  await pick(page, "Project", name);
  await pick(page, "Property", "Status");
  await pick(page, "Option", "Todo");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settles(page, /\/api\/charts$/, () =>
    page.getByRole("button", { name: "Add chart" }).click(),
  );

  const chart = page.getByTestId("chart");
  await expect(chart).toHaveCount(1);
  await expect(chart).toContainText("Entered Todo");
  const bars = chart.getByTestId("chart-bar");
  await expect(bars).toHaveCount(30);
  await expect(bars.last()).toHaveAttribute("data-count", "2");
  await expect(bars.last()).toHaveAttribute("title", /: 2$/);
  await expect(chart.getByTestId("chart-today")).toHaveText("2");
  await expect(chart.getByTestId("chart-foot")).toContainText("0.1 a day");
  await barsInside(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await barsInside(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await chart.getByRole("button", { name: "Delete the chart Entered Todo" }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("The tasks and their history stay");
  await settles(page, /\/api\/charts\/[0-9a-f-]+$/, () =>
    ask.getByRole("button", { name: "Yes, delete" }).click(),
  );
  await expect(page.getByTestId("chart")).toHaveCount(0);
});
