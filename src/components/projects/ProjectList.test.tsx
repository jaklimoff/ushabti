import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { ME, newProject, renderWithBoard } from "@/test/board";
import type { ListSummary } from "@/lib/lists";
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
    await renderWithBoard(<ProjectList user={ME} projects={rows} lists={lists} />, newProject());
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
