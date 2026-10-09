import { expect, test } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;

type Board = {
  today: string;
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  views: { name: string; kind: string; groupById: string | null }[];
};

async function boardOf(page: Page, projectId: string): Promise<Board> {
  return (await page.request.get(`/api/projects/${projectId}/board`)).json();
}

/** A day so many days after another, as YYYY-MM-DD. */
function plus(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/*
 * A Version select with four options: one with a target and nothing to start
 * it by, one open around today, one shipped, and one with no target date.
 * Ghost comes first, because an option after a dated one starts when that one
 * ends; only the first dated option waits for a task to start it.
 */
async function versions(page: Page, projectId: string) {
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Version", type: "select", options: ["Ghost", "Beta", "Alpha", "Someday"] },
  });
  expect(made.status()).toBe(201);
  const { today, properties } = await boardOf(page, projectId);
  const version = properties.find((p) => p.name === "Version")!;
  const id = (name: string) => version.options.find((o) => o.name === name)!.id;
  const dates: Record<string, object> = {
    Beta: { startAt: plus(today, -10), targetAt: plus(today, 20) },
    Alpha: { startAt: plus(today, -40), targetAt: plus(today, -15), shippedAt: plus(today, -14) },
    Someday: { startAt: plus(today, -5) },
    Ghost: { targetAt: plus(today, 30) },
  };
  for (const [name, data] of Object.entries(dates)) {
    const patched = await page.request.patch(`/api/options/${id(name)}`, { data });
    expect(patched.status()).toBe(200);
  }
  return { version, today };
}

async function addRoadmap(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.getByRole("button", { name: "New view" }).click();
  await page.getByLabel("Name of the new view").fill("Plan");
  await page
    .getByRole("group", { name: "What the new view shows" })
    .getByRole("button", { name: "Roadmap", exact: true })
    .click();
  await page.getByRole("button", { name: "Version", exact: true }).click();
  await page.getByRole("button", { name: "Create view" }).click();
  await expect(page.getByTestId("roadmap-view")).toBeVisible();
}

/*
 * The first walk stays end to end, and is a smoke test: it makes the view
 * from the strip and reads it back. The bars are `roadmap.test.ts`, the
 * canvas and its panel `Roadmap.test.tsx`, and what the server sends
 * `release-route.test.ts`.
 */
test.describe("A roadmap", () => {
  test(
    "draws one bar per dated option, with the shipped below, and a line for today",
    { tag: "@smoke" },
    async ({ page }) => {
      await register(page);
      const projectId = await createProject(page, unique("Roadmap"));
      const { version } = await versions(page, projectId);
      await addRoadmap(page, projectId);

      const rows = page.getByTestId("roadmap-row");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText("Beta");
      await expect(rows.nth(0)).toContainText("0 of 0 tasks done");
      await expect(rows.nth(1)).toContainText("Alpha");
      await expect(rows.nth(1)).toContainText("Shipped");
      await expect(page.getByTestId("roadmap-today")).toBeInViewport();
      await expect(page.getByTestId("roadmap-axis")).toContainText(
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+/,
      );

      /* The view names its property, as a board does, and holds it. */
      const board = await boardOf(page, projectId);
      expect(board.views.find((v) => v.name === "Plan")).toMatchObject({
        kind: "roadmap",
        groupById: version.id,
      });
      const refused = await page.request.delete(`/api/properties/${version.id}`);
      expect(refused.status()).toBe(400);
      expect((await refused.json()).error).toContain('"Plan"');
    },
  );
});
