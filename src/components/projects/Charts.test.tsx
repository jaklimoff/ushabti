import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import type { ChartChoice, ChartDTO } from "@/lib/charts";
import { Charts } from "./Charts";

/*
 * One day of a chart on Home is read exactly, by pointer or by key. What a
 * chart counts is route tested; this says what the bars show of it.
 */

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

/* Thirty days to Fri 9 Oct 2026, each counting its own place. */
const days = Array.from({ length: 30 }, (_, i) => ({
  day: new Date(Date.UTC(2026, 9, 9 - 29 + i)).toISOString().slice(0, 10),
  count: i % 4,
}));
const chart: ChartDTO = {
  id: "00000000-0000-4000-8000-000000000001",
  project: { id: "00000000-0000-4000-8000-000000000002", key: "HAR", name: "Harbour" },
  propertyId: "p",
  optionId: "o",
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

  test("every day is one grey and only today wears the accent", async () => {
    await draw();
    const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
    const probe = document.createElement("span");
    probe.style.color = accent;
    document.body.append(probe);
    const accentRgb = getComputedStyle(probe).color;
    probe.remove();
    const fills = page
      .getByTestId("chart-bar")
      .elements()
      .map((el) => getComputedStyle(el.firstElementChild!));
    expect(new Set(fills.slice(0, 29).map((f) => f.backgroundColor)).size).toBe(1);
    expect(fills[0].backgroundColor).not.toBe(accentRgb);
    expect(fills[29].backgroundColor).toBe(accentRgb);
    expect(fills.map((f) => f.opacity)).toEqual(Array(30).fill("1"));
    expect(box(bars().element()).height).toBe(44);
    await hoverDay(4);
    const swatch = tip().element().querySelector("span")!;
    expect(getComputedStyle(swatch).backgroundColor).toBe(accentRgb);
  });

  test("New chart opens the picker in the first slot, and waits for a select", async () => {
    const choices = [
      {
        id: chart.project.id,
        key: "HAR",
        name: "Harbour",
        properties: [{ id: "p", name: "Status", options: [{ id: "o", name: "Todo" }] }],
      },
    ];
    await render(<Charts charts={[chart]} choices={choices} />);
    await page.getByRole("button", { name: "+ New chart" }).click();
    const slots = document.querySelector('[data-testid="chart-picker"]')!.parentElement!.children;
    expect(slots[0].getAttribute("data-testid")).toBe("chart-picker");
    await cleanup();
    await draw();
    const none = page.getByTestId("chart-new");
    await expect.element(none).toBeDisabled();
    await expect.element(none).toHaveAttribute("title", "No project has a select to count yet.");
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

/* Two projects: Harbour has two selects, Quay one. */
const opt = (id: string, name: string) => ({ id, name });
const choices: ChartChoice[] = [
  {
    id: chart.project.id,
    key: "HAR",
    name: "Harbour",
    properties: [
      {
        id: "p",
        name: "Status",
        options: [opt("o", "Todo"), opt("o2", "Doing"), opt("o3", "Done")],
      },
      { id: "q", name: "Priority", options: [opt("q1", "Low"), opt("q2", "High")] },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    key: "QUA",
    name: "Quay",
    properties: [{ id: "r", name: "Stage", options: [opt("r1", "Open"), opt("r2", "Closed")] }],
  },
];

type Sent = { path: string; body: { projectId: string; propertyId: string; optionId: string } };

/**
 * Answers a preview with a chart that counts the option's place in its
 * select on today, and holds the answer for `slow` while it names that option.
 */
function serve({ slow = "", status = 201, error = "" } = {}) {
  const sent: Sent[] = [];
  const held: (() => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname;
      const body = JSON.parse(String(init?.body ?? "{}")) as Sent["body"];
      sent.push({ path, body });
      if (path === "/api/charts")
        return new Response(JSON.stringify(error ? { error } : {}), { status });
      const project = choices.find((c) => c.id === body.projectId)!;
      const property = project.properties.find((p) => p.id === body.propertyId)!;
      const at = property.options.findIndex((o) => o.id === body.optionId);
      const drawn: ChartDTO = {
        ...chart,
        id: "",
        project: { id: project.id, key: project.key, name: project.name },
        propertyId: property.id,
        optionId: body.optionId,
        property: property.name,
        option: property.options[at].name,
        days: days.map((d, i) => ({ ...d, count: i === 29 ? at + 1 : 0 })),
      };
      if (body.optionId === slow) await new Promise<void>((go) => held.push(go));
      return new Response(JSON.stringify({ chart: drawn }), { status: 200 });
    }),
  );
  return { sent, release: () => held.splice(0).forEach((go) => go()) };
}

const picker = () => page.getByTestId("chart-picker");
const preview = () => page.getByTestId("chart-preview");
const pill = (name: string) => picker().getByRole("button", { name, exact: true });
const pressed = () =>
  page
    .getByTestId("chart-option")
    .elements()
    .filter((el) => el.getAttribute("aria-pressed") === "true")
    .map((el) => el.textContent);
const add = () => page.getByRole("button", { name: "Add chart" });

async function openPicker(charts: ChartDTO[] = []) {
  await render(
    <div style={{ width: 420 }}>
      <Charts charts={charts} choices={choices} />
    </div>,
  );
  await page.getByTestId("chart-new").first().click();
}

async function pickIn(label: string, name: string) {
  await picker().getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name }).click();
}

describe("A new chart", () => {
  test("names Project and Property, and a project with one select names it in place", async () => {
    serve();
    await openPicker();
    const labels = [...picker().element().querySelectorAll("span")]
      .map((el) => el.textContent)
      .filter((t) => t === "Project" || t === "Property");
    expect(labels).toEqual(["Project", "Property"]);
    await expect.element(picker().getByRole("combobox", { name: "Property" })).toBeVisible();
    await expect.element(picker().getByText("Count the tasks that enter")).toBeVisible();

    await pickIn("Project", "Quay");
    await expect
      .element(picker().getByRole("combobox", { name: "Property" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByTestId("chart-property")).toHaveTextContent("Stage");
    expect(pressed()).toEqual(["Closed"]);
  });

  test("offers the options as pills, one pressed, starting on the last one not charted", async () => {
    serve();
    await openPicker([{ ...chart, optionId: "o3", option: "Done" }]);
    await expect.poll(pressed).toEqual(["Doing"]);
    await expect.element(pill("Done")).toHaveAttribute("aria-pressed", "false");
    await pill("Todo").click();
    expect(pressed()).toEqual(["Todo"]);
    await expect.element(add()).toBeEnabled();
  });

  test("starts on the last option when every option is charted, and says why it cannot add", async () => {
    serve({ status: 409 });
    const all = ["o", "o2", "o3"].map((optionId) => ({ ...chart, optionId }));
    await openPicker(all);
    expect(pressed()).toEqual(["Done"]);
    const quiet = getComputedStyle(pill("Done").element()).opacity;
    await pickIn("Property", "Priority");
    const fresh = getComputedStyle(pill("High").element()).opacity;
    expect(Number(quiet)).toBeLessThan(Number(fresh));
    await expect.element(page.getByTestId("chart-taken")).not.toBeInTheDocument();
    await pickIn("Property", "Status");
    await expect
      .element(page.getByTestId("chart-taken"))
      .toHaveTextContent("You already have this chart. Pick another column.");
    await expect.element(add()).toBeDisabled();
  });

  test("the preview follows the project, the property and the option, and drops a late answer", async () => {
    const { sent, release } = serve({ slow: "o2" });
    await openPicker();
    const face = () => preview().element().textContent ?? "";
    await expect.poll(face).toMatch(/HAREntered Done/);
    await expect.element(preview().getByTestId("chart-today")).toHaveTextContent("3");
    expect(face()).toMatch(/HAREntered DonePreview/);
    expect(preview().getByTestId("chart-bar").elements()).toHaveLength(30);

    // Doing is held; Todo answers first, and Doing's late answer must not land on it.
    await pill("Doing").click();
    await expect.element(preview()).toHaveAttribute("aria-busy", "true");
    await pill("Todo").click();
    await expect.poll(face).toMatch(/Entered Todo/);
    release();
    await new Promise((go) => setTimeout(go, 50));
    expect(face()).toMatch(/Entered Todo/);

    await pickIn("Property", "Priority");
    await expect.poll(face).toMatch(/Entered High/);
    await pickIn("Project", "Quay");
    await expect.poll(face).toMatch(/QUAEntered Closed/);
    await expect.element(preview().getByTestId("chart-today")).toHaveTextContent("2");
    expect(
      sent.filter((s) => s.path === "/api/charts/preview").map((s) => s.body.optionId),
    ).toEqual(["o3", "o2", "o", "q2", "r2"]);
  });

  test("the preview is drawn dimmer than a saved chart, with today in the accent", async () => {
    serve();
    await openPicker([chart]);
    await expect.element(preview().getByTestId("chart-bars")).toBeInTheDocument();
    const bars = preview().getByTestId("chart-bars").element();
    expect(Number(getComputedStyle(bars).opacity)).toBeLessThan(1);
    const saved = page.getByTestId("chart").getByTestId("chart-bars").element();
    expect(getComputedStyle(saved).opacity).toBe("1");
    const fills = [...bars.children].map((el) => getComputedStyle(el.firstElementChild!));
    expect(fills[29].backgroundColor).not.toBe(fills[0].backgroundColor);
  });

  test("Add chart sends the pick, and Cancel closes the form", async () => {
    const { sent } = serve();
    await openPicker();
    await pill("Doing").click();
    await add().click();
    await expect
      .poll(() => sent.find((s) => s.path === "/api/charts")?.body)
      .toEqual({
        projectId: chart.project.id,
        propertyId: "p",
        optionId: "o2",
      });
    await expect.element(picker()).not.toBeInTheDocument();
    await page.getByTestId("chart-new").first().click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(picker()).not.toBeInTheDocument();
  });
});
