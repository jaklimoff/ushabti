import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { ME, newProject, renderWithBoard } from "@/test/board";
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

  test("a move to the front sends no neighbour", async () => {
    const { sent } = await renderWithBoard(<ProjectList user={ME} projects={rows} />, newProject());
    const grip = page.getByRole("button", { name: "Move the project Lighthouse" });
    await keyboardDrag(grip, "{ArrowLeft}");
    await expect
      .poll(() => sent("PATCH").map((r) => [r.path, r.body]))
      .toEqual([[`/api/projects/${ids[1]}/position`, { afterId: null }]]);
  });
});
