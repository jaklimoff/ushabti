import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { ME, newProject, renderWithBoard } from "@/test/board";
import type { ListSummary } from "@/lib/lists";
import type { ChartChoice, ChartDTO } from "@/lib/charts";
import type { ProjectPulse } from "@/lib/pulse";
import { ProjectList, type ProjectRow } from "./ProjectList";

/*
 * A person's order of their projects on Home. The route keeps it, and
 * `project-order-route.test.ts` says how; this file says what a drag sends.
 */

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ids = ["a", "b", "c"].map((c) => `00000000-0000-4000-8000-00000000000${c}`);
const rows: ProjectRow[] = ["Harbour", "Lighthouse", "Quay"].map((name, i) => ({
  id: ids[i],
  name,
  key: name.slice(0, 3).toUpperCase(),
  color: "#7aa8f0",
  role: "member",
  waiting: 0,
}));

const chart: ChartDTO = {
  id: "00000000-0000-4000-8000-0000000000f1",
  project: { id: ids[0], key: "HAR", name: "Harbour" },
  property: "Status",
  option: "Todo",
  color: "#3fb0c8",
  days: Array.from({ length: 30 }, (_, i) => ({
    day: `2026-09-${String(i + 1).padStart(2, "0")}`,
    count: 0,
  })),
};

const choices: ChartChoice[] = [
  {
    id: ids[0],
    key: "HAR",
    name: "Harbour",
    properties: [{ id: "p1", name: "Status", options: [{ id: "o1", name: "Todo" }] }],
  },
];

const names = () =>
  page
    .getByTestId("project-card")
    .elements()
    .map((card) => rows.find((r) => card.textContent?.includes(r.name))?.name);

/* The lift is waited for, then the move: dnd-kit measures the cards in the
   frame after the lift, which nothing on the page says. */
async function keyboardDrag(grip: Locator, arrow: string) {
  (grip.element() as HTMLElement).focus();
  await userEvent.keyboard(" ");
  await expect.element(grip).toHaveAttribute("aria-pressed", "true");
  await pause(50);
  const before = (grip.element() as HTMLElement).getBoundingClientRect();
  await userEvent.keyboard(arrow);
  await expect
    .poll(() => {
      const now = (grip.element() as HTMLElement).getBoundingClientRect();
      return Math.abs(now.x - before.x) + Math.abs(now.y - before.y);
    })
    .toBeGreaterThan(8);
  await userEvent.keyboard(" ");
}

describe("The projects on Home", () => {
  test("move with the keyboard, and the move names the project it landed after", async () => {
    const { sent } = await renderWithBoard(<ProjectList user={ME} projects={rows} />, newProject());
    expect(names()).toEqual(["Harbour", "Lighthouse", "Quay"]);

    const grip = page.getByRole("button", { name: "Move the project Harbour" });
    await keyboardDrag(grip, "{ArrowRight}");

    await expect.poll(names).toEqual(["Lighthouse", "Harbour", "Quay"]);
    await expect
      .poll(() => sent("PATCH").map((r) => [r.path, r.body]))
      .toEqual([[`/api/projects/${ids[0]}/position`, { afterId: ids[1] }]]);
  });

  test("Home leads with projects, and lists and charts follow as outlines", async () => {
    const lists: ListSummary[] = [
      {
        id: "00000000-0000-4000-8000-0000000000d1",
        name: "Mine",
        count: 1,
        rows: [
          {
            id: "00000000-0000-4000-8000-0000000000e1",
            key: "HAR-1",
            title: "Fix the quay",
            projectId: ids[0],
            waiting: false,
            agent: "Builder",
            chip: null,
            createdAt: "2026-10-01T00:00:00Z",
          },
        ],
      },
    ];
    await renderWithBoard(
      <ProjectList user={ME} projects={rows} lists={lists} charts={[chart]} />,
      newProject(),
    );
    const heads = page.getByRole("heading", { level: 2 }).elements();
    expect(heads.map((h) => h.textContent)).toEqual(["Projects", "My lists", "Charts"]);
    const sections = heads.map((h) => h.closest("section")!.getBoundingClientRect());
    expect(Math.round(sections[1].top - sections[0].bottom)).toBe(44);
    expect(Math.round(sections[2].top - sections[1].bottom)).toBe(44);
    expect(getComputedStyle(heads[0]).fontSize).toBe("15px");
    expect(getComputedStyle(heads[1]).fontSize).toBe("13px");

    for (const name of ["+ New project", "+ New list", "+ New chart"]) {
      const press = page.getByRole(name === "+ New list" ? "link" : "button", { name });
      expect(getComputedStyle(press.element()).height).toBe("26px");
      expect(getComputedStyle(press.element()).borderStyle).toBe("none");
    }
    expect(document.querySelector('[class*="newCard"]')).toBeNull();
    expect(page.getByTestId("panel-shapes").elements()).toHaveLength(0);
    await expect
      .element(page.getByRole("link", { name: "+ New list" }))
      .toHaveAttribute("href", "/lists/new");

    const card = page.getByTestId("list-card").element();
    expect(getComputedStyle(card).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(card).borderTopWidth).toBe("1px");
    const key = page.getByText("HAR-1").element();
    expect(getComputedStyle(key).color).toBe("rgb(139, 145, 155)");
    const agent = page.getByTitle("At work on it").element();
    expect(getComputedStyle(agent).color).toBe("rgb(139, 145, 155)");
    const dot = agent.firstElementChild!;
    expect(getComputedStyle(dot).backgroundColor).toBe("rgb(127, 192, 140)");

    await page.getByRole("button", { name: "+ New project" }).click();
    await expect.element(page.getByRole("textbox", { name: "Project name" })).toHaveFocus();
  });

  test("a move to the front sends no neighbour", async () => {
    const { sent } = await renderWithBoard(<ProjectList user={ME} projects={rows} />, newProject());
    const grip = page.getByRole("button", { name: "Move the project Lighthouse" });
    await keyboardDrag(grip, "{ArrowLeft}");
    await expect
      .poll(() => sent("PATCH").map((r) => [r.path, r.body]))
      .toEqual([[`/api/projects/${ids[1]}/position`, { afterId: null }]]);
  });
});

describe("An empty section on Home", () => {
  test("with no projects, offers the first project and says lists and charts wait", async () => {
    await renderWithBoard(<ProjectList user={ME} projects={[]} />, newProject());
    const first = page.getByRole("group", { name: "Create your first project" });
    await expect.element(first).toBeVisible();
    expect(first.element().textContent).toContain(
      "A project is one board of tasks, shared with the people and agents you invite.",
    );
    expect(page.getByRole("button", { name: "+ New project" }).elements()).toHaveLength(0);
    expect(page.getByRole("textbox", { name: "Project name" }).elements()).toHaveLength(0);

    const lists = page.getByRole("group", { name: "Lists" });
    expect(lists.element().textContent).toContain(
      "Gather tasks from your projects in one place. Create a project first.",
    );
    const charts = page.getByRole("group", { name: "Charts" });
    expect(charts.element().textContent).toContain(
      "Count how many tasks enter a column each day. Create a project first.",
    );
    for (const quiet of [lists, charts]) {
      expect(quiet.element().querySelector("a, button")).toBeNull();
    }
    expect(page.getByTestId("list-new").elements()).toHaveLength(0);
    expect(page.getByTestId("chart-new").elements()).toHaveLength(0);

    await first.getByRole("button", { name: "New project" }).click();
    await expect.element(page.getByRole("textbox", { name: "Project name" })).toHaveFocus();
    expect(first.elements()).toHaveLength(0);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect
      .element(page.getByRole("group", { name: "Create your first project" }))
      .toBeVisible();
  });

  test("with a project and nothing else, lists and charts are wide panels", async () => {
    await page.viewport(1280, 800);
    await renderWithBoard(
      <ProjectList user={ME} projects={rows} chartChoices={choices} />,
      newProject(),
    );
    expect(page.getByRole("group", { name: "Create your first project" }).elements()).toHaveLength(
      0,
    );
    const list = page.getByRole("link", { name: "+ New list" });
    await expect.element(list).toHaveAttribute("href", "/lists/new");
    await expect.element(list).toHaveAccessibleDescription(/picked by rules/);
    expect(page.getByTestId("list-new").elements()).toHaveLength(1);
    expect(list.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(120);

    const chartPanel = page.getByRole("button", { name: "+ New chart" });
    await expect.element(chartPanel).toHaveAccessibleDescription(/such as how many shipped/);
    expect(page.getByTestId("chart-new").elements()).toHaveLength(1);

    const shapes = page.getByTestId("panel-shapes").elements();
    expect(shapes).toHaveLength(2);
    for (const s of shapes) expect(s.getAttribute("aria-hidden")).toBe("true");

    /* Side by side on a wide screen, words above the shapes on a phone. */
    const [words, rowsOf] = [list.element().firstElementChild!, shapes[0]];
    let a = words.getBoundingClientRect();
    let b = rowsOf.getBoundingClientRect();
    expect(b.left).toBeGreaterThanOrEqual(a.right);
    await page.viewport(390, 780);
    await expect
      .poll(() => rowsOf.getBoundingClientRect().top >= words.getBoundingClientRect().bottom)
      .toBe(true);
    a = words.getBoundingClientRect();
    b = rowsOf.getBoundingClientRect();
    expect(Math.round(b.left)).toBe(Math.round(a.left));
    await page.viewport(1280, 800);

    /* The chart panel opens the picker in its place. */
    await chartPanel.click();
    await expect.element(page.getByTestId("chart-picker")).toBeVisible();
    expect(page.getByTestId("chart-new").elements()).toHaveLength(0);
  });

  test("a chart panel stays disabled while no project has a select", async () => {
    await renderWithBoard(<ProjectList user={ME} projects={rows} />, newProject());
    const panel = page.getByRole("button", { name: "+ New chart" });
    await expect.element(panel).toBeDisabled();
    await expect.element(panel).toHaveAttribute("title", "No project has a select to count yet.");
  });
});

const pulseOf = (over: Partial<ProjectPulse> = {}): ProjectPulse => ({
  viewId: null,
  columns: [
    { id: "c1", name: "Todo", color: "#e0574d", count: 9 },
    { id: "c2", name: "In Progress", color: "#3fb0c8", count: 3 },
    { id: "c3", name: "Ready", color: "#4f8a5b", count: 0 },
    { id: "c4", name: "Shipped", color: "#6d5bd0", count: 12 },
  ],
  agents: { names: [], silent: 0 },
  last: {
    at: new Date().toISOString(),
    who: null,
    taskKey: null,
    taskTitle: null,
    kind: "title",
    propertyId: null,
    value: null,
  },
  heading: null,
  people: [
    { id: "u1", name: "Ada Lovelace", kind: "human" },
    { id: "u2", name: "Builder", kind: "agent" },
  ],
  quiet: false,
  days: [0, 2, 0, 0, 5, 1, 0, 0, 0, 3, 0, 8, 0, 4],
  ...over,
});

const rectOf = (el: Element) => el.getBoundingClientRect();

/* The grip carries an unseen copy of the key, so the square is the one outside it. */
const squareOf = (key: string) =>
  page
    .getByText(key, { exact: true })
    .elements()
    .find((el) => !el.closest("button"))!;

describe("A project card", () => {
  test("reads the colour square, the name, the role, the badge and a gear that holds its place", async () => {
    await page.viewport(1280, 800);
    const harbour = { ...rows[0], role: "admin", waiting: 2, pulse: pulseOf() };
    await renderWithBoard(<ProjectList user={ME} projects={[harbour]} />, newProject());
    const card = page.getByTestId("project-card");

    const key = squareOf("HAR");
    expect(getComputedStyle(key).backgroundColor).toBe("rgb(122, 168, 240)");
    expect(getComputedStyle(key).color).toBe("rgb(20, 22, 26)");
    expect(Math.round(rectOf(key).height)).toBe(22);
    const name = page.getByText("Harbour", { exact: true }).element();
    expect(getComputedStyle(name).fontSize).toBe("15px");
    expect(getComputedStyle(name).fontWeight).toBe("600");
    await expect.element(page.getByText("admin", { exact: true })).toBeVisible();
    await expect
      .element(card.getByTestId("project-waiting"))
      .toHaveTextContent("2 waiting for you");

    const gear = page.getByRole("link", { name: "Settings for Harbour" });
    await expect.element(gear).toHaveAttribute("title", "Project settings");
    expect(gear.element().querySelector("svg")).not.toBeNull();
    expect(Math.round(rectOf(gear.element()).width)).toBe(26);
    expect(getComputedStyle(gear.element()).opacity).toBe("0");

    const grip = page.getByRole("button", { name: "Move the project Harbour" });
    expect(getComputedStyle(grip.element()).opacity).toBe("0");
    /* The grip lies on the colour square. */
    const [g, k] = [rectOf(grip.element()), rectOf(key)];
    expect(Math.round(g.left)).toBe(Math.round(k.left));
    expect(Math.round(g.top)).toBe(Math.round(k.top));
    /* 22px wide in the app's mono, which e2e/project-card.spec.ts measures. */
    expect(g.width).toBe(k.width);
    expect(g.height).toBe(k.height);

    const before = [name, gear.element(), card.getByTestId("project-waiting").element()].map((el) =>
      rectOf(el).toJSON(),
    );
    await userEvent.hover(page.getByTestId("project-columns"));
    await expect.poll(() => getComputedStyle(gear.element()).opacity).toBe("1");
    await expect.poll(() => getComputedStyle(grip.element()).opacity).toBe("1");
    const after = [name, gear.element(), card.getByTestId("project-waiting").element()].map((el) =>
      rectOf(el).toJSON(),
    );
    expect(after).toEqual(before);

    /* The gear's own hover: the cog turns and takes the accent. */
    await userEvent.hover(gear);
    await expect.poll(() => getComputedStyle(gear.element()).color).toBe("rgb(63, 176, 200)");
    await expect
      .poll(() => getComputedStyle(gear.element().querySelector("svg")!).transform)
      .not.toBe("none");
  });

  test("shares the board out in greys, each count named, and the footer names who is on it", async () => {
    const harbour = { ...rows[0], pulse: pulseOf({ agents: { names: ["Builder"], silent: 0 } }) };
    await renderWithBoard(<ProjectList user={ME} projects={[harbour]} />, newProject());
    const counts = page.getByTestId("project-column").elements();
    expect(counts.map((c) => c.textContent)).toEqual([
      "Todo 9",
      "In Progress 3",
      "Ready 0",
      "Shipped 12",
    ]);
    const shares = page.getByTestId("project-bar").element().querySelectorAll("[data-column]");
    expect(shares).toHaveLength(3);
    const light = (el: Element) => {
      const parts = getComputedStyle(el)
        .backgroundColor.match(/[\d.]+/g)!
        .map(Number);
      return parts[0] + parts[1] + parts[2];
    };
    expect(light(shares[0])).toBeLessThan(light(shares[1]));
    expect(light(shares[1])).toBeLessThan(light(shares[2]));
    /* No column colour reaches the card. */
    expect(getComputedStyle(shares[0]).backgroundColor).not.toBe("rgb(224, 87, 77)");
    expect(getComputedStyle(counts[0].firstElementChild!).backgroundColor).toBe(
      getComputedStyle(shares[0]).backgroundColor,
    );

    const ada = page.getByRole("img", { name: "Ada Lovelace" });
    await expect.element(ada).toHaveTextContent("AL");
    await expect.element(ada).toHaveAttribute("title", "Ada Lovelace");
    expect(getComputedStyle(ada.element()).borderRadius).toBe("50%");
    const agent = page.getByRole("img", { name: "Builder" });
    expect(getComputedStyle(agent.element()).borderRadius).toBe("4px");
    await expect.element(page.getByTestId("project-agents")).toHaveTextContent("Builder working");
    expect(page.getByTestId("project-last").elements()).toHaveLength(0);
  });

  test("lines up its rows with the card beside it", async () => {
    await page.viewport(1280, 800);
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`,
      name: `Column number ${i}`,
      color: "#3fb0c8",
      count: i,
    }));
    const projects = [
      { ...rows[0], pulse: pulseOf({ columns: many }) },
      { ...rows[1], pulse: pulseOf({ columns: null }) },
    ];
    await renderWithBoard(<ProjectList user={ME} projects={projects} />, newProject());
    const tops = (id: string) =>
      page
        .getByTestId(id)
        .elements()
        .map((el) => rectOf(el).top);
    const [a, b] = tops("project-foot");
    expect(page.getByTestId("project-card").elements()).toHaveLength(2);
    /* The long one really is longer, so the test proves the line-up. */
    expect(rectOf(page.getByTestId("project-columns").element()).height).toBeGreaterThan(40);
    expect(Math.round(a)).toBe(Math.round(b));
    const [c, d] = tops("project-activity");
    expect(Math.round(c)).toBe(Math.round(d));
    await expect
      .element(page.getByTestId("project-no-columns"))
      .toHaveTextContent("The main view draws no columns.");
    await expect.element(page.getByTestId("project-last").first()).toHaveTextContent("just now");
  });

  test("a long key widens the square, and the grip with it", async () => {
    const wide = { ...rows[0], key: "HARBOR" };
    await renderWithBoard(<ProjectList user={ME} projects={[wide]} />, newProject());
    const key = squareOf("HARBOR");
    const grip = page.getByRole("button", { name: "Move the project Harbour" }).element();
    const [k, g] = [rectOf(key), rectOf(grip)];
    expect(k.width).toBeGreaterThan(30);
    expect(key.scrollWidth).toBeLessThanOrEqual(key.clientWidth);
    expect(g.width).toBe(k.width);
    expect(Math.round(g.left)).toBe(Math.round(k.left));
  });

  test("reads dimmed after three weeks without a change", async () => {
    const projects = [
      { ...rows[0], pulse: pulseOf({ quiet: true }) },
      { ...rows[1], pulse: pulseOf() },
    ];
    await renderWithBoard(<ProjectList user={ME} projects={projects} />, newProject());
    const opacity = (text: string) => getComputedStyle(squareOf(text)).opacity;
    expect(opacity("Harbour")).toBe("0.45");
    expect(opacity("HAR")).toBe("0.45");
    expect(opacity("Lighthouse")).toBe("1");
    expect(opacity("LIG")).toBe("1");
  });
});

describe("A project card's fourteen days", () => {
  test("draws a grey bar a day, today in the accent, and the total beside them", async () => {
    await page.viewport(1280, 800);
    const projects = [
      { ...rows[0], pulse: pulseOf() },
      { ...rows[1], pulse: pulseOf({ days: [...Array(13).fill(0), 1] }) },
    ];
    await renderWithBoard(<ProjectList user={ME} projects={projects} />, newProject());
    const bars = page.getByTestId("project-day").elements();
    expect(bars).toHaveLength(28);
    const harbour = bars.slice(0, 14).map((el) => rectOf(el).height);
    expect(Math.max(...harbour)).toBe(32);
    // A day with nothing is a hairline.
    expect(harbour[0]).toBe(2);
    expect(harbour[13]).toBe(16);
    const fill = (el: Element) => getComputedStyle(el).backgroundColor;
    expect(fill(bars[13])).not.toBe(fill(bars[11]));
    expect(fill(bars[11])).toBe(fill(bars[9]));

    const [a, b] = page
      .getByTestId("project-day")
      .elements()
      .filter((_, i) => i === 0 || i === 14)
      .map((el) => rectOf(el).bottom);
    expect(Math.round(a)).toBe(Math.round(b));
    const said = page.getByTestId("project-changes").elements();
    expect(said[0].textContent).toBe("23 changes, 14 days");
    expect(said[1].textContent).toBe("1 change, 14 days");
    await expect
      .element(
        page.getByRole("img", {
          name: "23 changes in 14 days. The busiest day was 2 days ago, with 8.",
        }),
      )
      .toBeVisible();
  });

  test("today's bar stays grey when it has nothing", async () => {
    const harbour = { ...rows[0], pulse: pulseOf({ days: [...Array(13).fill(1), 0] }) };
    await renderWithBoard(<ProjectList user={ME} projects={[harbour]} />, newProject());
    const bars = page.getByTestId("project-day").elements();
    expect(bars[13].hasAttribute("data-today")).toBe(false);
  });

  test("reads quiet for the time since the last change when the fourteen days are empty", async () => {
    const at = new Date(Date.now() - 22 * 86_400_000).toISOString();
    const last = { ...pulseOf().last!, at };
    const projects = [
      { ...rows[0], pulse: pulseOf({ days: Array(14).fill(0), last }) },
      { ...rows[1], pulse: pulseOf({ days: Array(14).fill(0), last: null }) },
    ];
    await renderWithBoard(<ProjectList user={ME} projects={projects} />, newProject());
    const said = page.getByTestId("project-changes").elements();
    expect(said[0].textContent).toBe("Quiet for 3 weeks");
    expect(said[1].textContent).toBe("No changes yet");
  });
});

describe("A project card's second row", () => {
  test("reads the release, its ship day and a grey bar of done over total", async () => {
    const heading = {
      kind: "release" as const,
      property: "Release",
      name: "0.23",
      day: "2026-10-14",
      left: 5,
      done: 12,
      total: 18,
    };
    const harbour = { ...rows[0], pulse: pulseOf({ heading }) };
    await renderWithBoard(<ProjectList user={ME} projects={[harbour]} />, newProject());
    const row = page.getByTestId("project-release");
    await expect.element(row).toHaveTextContent("Release 0.23 · ships Oct 1412 / 18");
    const bar = row.element().querySelector("[aria-hidden]")!;
    expect(Math.round(bar.getBoundingClientRect().width)).toBeLessThanOrEqual(120);
    const fill = bar.firstElementChild!;
    expect(getComputedStyle(fill).backgroundColor).toBe("rgb(164, 170, 179)");
    expect(fill.getBoundingClientRect().width / bar.getBoundingClientRect().width).toBeCloseTo(
      12 / 18,
      1,
    );
  });

  test("reads the sprint and the days it has left", async () => {
    const heading = {
      kind: "sprint" as const,
      property: "Sprint",
      name: "14",
      day: "2026-10-12",
      left: 3,
      done: 1,
      total: 2,
    };
    const harbour = { ...rows[0], pulse: pulseOf({ heading }) };
    await renderWithBoard(<ProjectList user={ME} projects={[harbour]} />, newProject());
    await expect
      .element(page.getByTestId("project-sprint"))
      .toHaveTextContent("Sprint 14 · 3 days left1 / 2");
  });

  test("reads who did what to which task, and the column it went to", async () => {
    const heading = {
      kind: "change" as const,
      who: "Jack",
      verb: "moved",
      taskKey: "MC-120",
      taskTitle: "Cards table keeps the side pane open",
      to: "Review",
    };
    const harbour = { ...rows[0], pulse: pulseOf({ heading }) };
    await renderWithBoard(<ProjectList user={ME} projects={[harbour]} />, newProject());
    const row = page.getByTestId("project-change");
    await expect
      .element(row)
      .toHaveTextContent("Jack moved MC-120 Cards table keeps the side pane open→ Review");
    const key = page.getByText("MC-120").element();
    expect(getComputedStyle(key).fontFamily).toMatch(/mono/i);
  });

  test("stays empty on a project with no activity", async () => {
    const harbour = { ...rows[0], pulse: pulseOf({ last: null, heading: null }) };
    await renderWithBoard(<ProjectList user={ME} projects={[harbour]} />, newProject());
    expect(page.getByTestId("project-goal").element().childElementCount).toBe(0);
  });
});
