import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import type { ChartDTO } from "@/lib/charts";
import { Charts } from "./Charts";

/*
 * One day of a chart on Home is read exactly, by pointer or by key. What a
 * chart counts is route tested; this says what the bars show of it.
 */

afterEach(() => cleanup());

/* Thirty days to Fri 9 Oct 2026, each counting its own place. */
const days = Array.from({ length: 30 }, (_, i) => ({
  day: new Date(Date.UTC(2026, 9, 9 - 29 + i)).toISOString().slice(0, 10),
  count: i % 4,
}));
const chart: ChartDTO = {
  id: "00000000-0000-4000-8000-000000000001",
  project: { id: "00000000-0000-4000-8000-000000000002", key: "HAR", name: "Harbour" },
  property: "Status",
  option: "Todo",
  color: "#3fb0c8",
  days,
};

const bars = () => page.getByTestId("chart-bars");
const tip = () => page.getByTestId("chart-tip");
/* Read off the node: the tooltip is hidden from the reader and the live region
   is clipped, and the locator's text matcher answers for neither. */
const text = (id: string) => page.getByTestId(id).element().textContent;
const box = (el: Element) => el.getBoundingClientRect();
const lit = () =>
  page
    .getByTestId("chart-bar")
    .elements()
    .flatMap((el, i) => (el.hasAttribute("data-lit") ? [i] : []));
const opacities = () =>
  page
    .getByTestId("chart-bar")
    .elements()
    .map((el) => getComputedStyle(el.firstElementChild!).opacity);

async function draw() {
  await render(
    <div style={{ width: 360 }}>
      <Charts charts={[chart]} choices={[]} />
    </div>,
  );
}

/* The pointer over the middle of day `i`, inside the strip. */
async function hoverDay(i: number) {
  const r = box(bars().element());
  const w = r.width / days.length;
  await userEvent.hover(bars(), { position: { x: w * i + w / 2, y: r.height / 2 } });
}

/* How far the caret is from the lit bar's middle. It is read after the
   tooltip's slide, which is why the callers poll it. */
function caretOff(i: number) {
  const el = tip().element();
  const caret =
    box(el).left + el.clientLeft + parseFloat(getComputedStyle(el).getPropertyValue("--caret"));
  const bar = box(page.getByTestId("chart-bar").elements()[i]);
  return Math.abs(caret - (bar.left + bar.width / 2));
}

/* The tooltip lies inside the card, and its caret is over the lit bar. */
async function insideWithCaretOn(i: number) {
  await expect.poll(() => caretOff(i)).toBeLessThan(0.5);
  const card = box(page.getByTestId("chart").element());
  const t = box(tip().element());
  expect(t.left).toBeGreaterThanOrEqual(card.left);
  expect(t.right).toBeLessThanOrEqual(card.right);
  expect(t.top).toBeGreaterThanOrEqual(card.top);
}

describe("A chart on Home", () => {
  test("hover lights one day, dims the rest and says its day and count", async () => {
    await draw();
    const before = opacities();
    await hoverDay(10);
    await expect.poll(lit).toEqual([10]);
    await expect.poll(() => text("chart-tip")).toMatch(/Sun, 20 Sept/);
    await expect.poll(() => text("chart-tip")).toMatch(/Entered Todo2$/);
    await expect.poll(() => opacities()[10]).toBe("1");
    await expect.poll(() => opacities()[29]).toBe("0.2");
    await expect.poll(() => text("chart-said")).toMatch(/Sun, 20 Sept: 2/);

    // Across the gap between two bars the highlight moves on, never drops.
    const r = box(bars().element());
    const w = r.width / days.length;
    for (const x of [w * 11 - 0.5, w * 11 + 0.5]) {
      await userEvent.hover(bars(), { position: { x, y: 4 } });
      await expect.poll(lit).toHaveLength(1);
      await expect.element(tip()).toBeInTheDocument();
    }

    await userEvent.hover(page.getByRole("heading", { name: "Charts" }));
    await expect.element(tip()).not.toBeInTheDocument();
    await expect.poll(lit).toEqual([]);
    await expect.poll(opacities).toEqual(before);
  });

  test("the tooltip stays inside the card at both edges, its caret on the bar", async () => {
    await draw();
    await hoverDay(0);
    await expect.poll(() => text("chart-tip")).toMatch(/Thu, 10 Sept/);
    await insideWithCaretOn(0);
    await hoverDay(29);
    await expect.poll(() => text("chart-tip")).toMatch(/Today · Fri, 9 Oct/);
    await expect.poll(lit).toEqual([29]);
    await insideWithCaretOn(29);
  });

  test("the chart is one tab stop walked with the arrows, Home and End", async () => {
    await draw();
    const remove = page.getByRole("button", { name: "Delete the chart" });
    (remove.element() as HTMLElement).focus();
    await userEvent.keyboard("{Tab}");
    await expect.element(bars()).toHaveFocus();
    await expect.poll(lit).toEqual([29]);
    await expect.poll(() => text("chart-said")).toMatch(/Today · Fri, 9 Oct: 1/);
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(lit).toEqual([28]);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await expect.poll(lit).toEqual([29]);
    await userEvent.keyboard("{Home}");
    await expect.poll(lit).toEqual([0]);
    await expect.poll(() => text("chart-said")).toMatch(/Thu, 10 Sept: 0/);
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(lit).toEqual([0]);
    await userEvent.keyboard("{End}");
    await expect.poll(lit).toEqual([29]);
    await userEvent.keyboard("{Escape}");
    await expect.poll(lit).toEqual([]);
    await expect.element(tip()).not.toBeInTheDocument();
    await expect.poll(() => text("chart-said")).toBe("");
    // The next stop is past the chart: no bar is a stop of its own.
    await userEvent.keyboard("{Tab}");
    await expect.element(bars()).not.toHaveFocus();
  });

  test("the day is said in a live region", async () => {
    await draw();
    const said = page.getByTestId("chart-said");
    await expect.element(said).toHaveAttribute("aria-live", "polite");
    await expect.element(tip()).not.toBeInTheDocument();
    await hoverDay(3);
    await expect.poll(() => text("chart-said")).toMatch(/Sun, 13 Sept: 3 entered Todo/);
  });
});
