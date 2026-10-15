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
  // The strip spans the chart's content box. It once shared a class with the
  // card's strip and stopped at 140px.
  const fit = await chart.evaluate((el) => {
    const style = getComputedStyle(el);
    const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const strip = el.querySelector('[data-testid="chart-bars"]')!.getBoundingClientRect();
    return { inner, strip: strip.width };
  });
  expect(fit.strip).toBeGreaterThanOrEqual(fit.inner - 1);
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
  /* The card's own strip keeps its size beside the chart's. */
  const strip = page.getByTestId("project-activity").first().getByRole("img").first();
  const card = await strip.boundingBox();
  expect(card?.height).toBe(32);
  expect(card!.width).toBeLessThanOrEqual(140);
  /* No chart yet: the wide panel makes the first. */
  const charts = page.getByTestId("my-charts");
  await expect(charts.getByTestId("panel-shapes")).toHaveAttribute("aria-hidden", "true");
  await page.getByTestId("chart-new").click();
  const picker = page.getByTestId("chart-picker");
  await pick(page, "Project", name);
  await pick(page, "Property", "Status");
  await picker.getByRole("button", { name: "Todo", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Todo", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  /* The preview is the chart it will be, counted by the server. */
  const preview = page.getByTestId("chart-preview");
  await expect(preview).toContainText("Entered Todo");
  await expect(preview.getByTestId("chart-today")).toHaveText("2");
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
  /* The first chart hands making the next one to the heading. */
  await expect(charts.getByTestId("panel-shapes")).toHaveCount(0);
  await expect(page.getByTestId("chart-new")).toHaveText("+ New chart");
  await barsInside(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await barsInside(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  /* The same chart cannot be added twice. */
  await page.getByTestId("chart-new").click();
  await pick(page, "Project", name);
  await pick(page, "Property", "Status");
  await picker.getByRole("button", { name: "Todo", exact: true }).click();
  await expect(picker).toContainText("You already have this chart. Pick another column.");
  await expect(page.getByRole("button", { name: "Add chart" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(picker).toHaveCount(0);

  await chart.getByRole("button", { name: "Delete the chart Entered Todo" }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("The tasks and their history stay");
  await settles(page, /\/api\/charts\/[0-9a-f-]+$/, () =>
    ask.getByRole("button", { name: "Yes, delete" }).click(),
  );
  await expect(page.getByTestId("chart")).toHaveCount(0);
});

test("a chart of two projects sums them in one bar and splits them on hover", async ({
  page,
}, testInfo) => {
  await register(page, "Chart Spreader");
  const here = unique("Harbour");
  const there = unique("Quay");
  await createProject(page, here);
  await addTask(page, "Todo", "Here one");
  await addTask(page, "Todo", "Here two");
  await createProject(page, there);
  await addTask(page, "Todo", "There one");

  await page.goto("/projects");
  await page.getByTestId("chart-new").click();
  const picker = page.getByTestId("chart-picker");
  const sources = picker.getByTestId("chart-source");
  async function choose(at: number, label: string, option: string) {
    const box = sources.nth(at).getByRole("combobox", { name: label });
    await box.click();
    await page.getByRole("option", { name: option }).click();
    await expect(box).toContainText(option);
  }
  await choose(0, "Project", here);
  await choose(0, "Property", "Status");
  await sources.nth(0).getByRole("button", { name: "Todo", exact: true }).click();

  await picker.getByRole("button", { name: "+ Add project" }).click();
  await expect(sources).toHaveCount(2);
  /* The project the chart already counts is not offered again. */
  await sources.nth(1).getByRole("combobox", { name: "Project" }).click();
  await expect(page.getByRole("option", { name: there })).toBeVisible();
  await expect(page.getByRole("option", { name: here })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await choose(1, "Project", there);
  await choose(1, "Property", "Status");
  await sources.nth(1).getByRole("button", { name: "Todo", exact: true }).click();

  const preview = page.getByTestId("chart-preview");
  await expect(preview.getByTestId("chart-today")).toHaveText("3");
  await settles(page, /\/api\/charts$/, () =>
    page.getByRole("button", { name: "Add chart" }).click(),
  );

  const chart = page.getByTestId("chart");
  await expect(chart).toHaveCount(1);
  const heading = chart.getByTestId("chart-heading");
  await expect(heading).toHaveAttribute("title", / · .* Entered Todo$/);
  const keys = (await heading.getAttribute("title"))!.replace(" Entered Todo", "").split(" · ");
  expect(keys).toHaveLength(2);
  await expect(chart.getByTestId("chart-today")).toHaveText("3");
  await expect(chart.getByTestId("chart-bar").last()).toHaveAttribute("data-count", "3");

  /* The bars take no pointer; the strip reads it. The right edge is today. */
  const strip = chart.getByTestId("chart-bars");
  const box = (await strip.boundingBox())!;
  await strip.hover({ position: { x: box.width - 2, y: box.height / 2 } });
  const tip = chart.getByTestId("chart-tip");
  await expect(tip).toContainText("Today");
  await expect(tip).toContainText("3");
  await expect(chart.getByTestId("chart-tip-split")).toHaveText(`${keys[0]} 2, ${keys[1]} 1`);
  await page.screenshot({ path: testInfo.outputPath("seen-chart-two-projects.png") });

  /* The same two projects again are refused. */
  await page.getByTestId("chart-new").click();
  await choose(0, "Project", here);
  await choose(0, "Property", "Status");
  await sources.nth(0).getByRole("button", { name: "Todo", exact: true }).click();
  await picker.getByRole("button", { name: "+ Add project" }).click();
  await choose(1, "Property", "Status");
  await sources.nth(1).getByRole("button", { name: "Todo", exact: true }).click();
  await expect(picker).toContainText("You already have this chart. Pick another column.");
  await expect(page.getByRole("button", { name: "Add chart" })).toBeDisabled();
});
