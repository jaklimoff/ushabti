import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { ME, newProject, renderWithBoard } from "@/test/board";
import type { ListSummary } from "@/lib/lists";
import type { ChartChoice, ChartDTO } from "@/lib/charts";
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
