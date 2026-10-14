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
 * ends; only the first dated option starts at its oldest task, or today.
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
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toContainText("Ghost");
      await expect(rows.nth(1)).toContainText("Beta");
      await expect(rows.nth(1)).toContainText("0 of 0 tasks done");
      await expect(rows.nth(2)).toContainText("Alpha");
      await expect(rows.nth(2)).toContainText("Shipped");
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

/*
 * A release is made where releases are seen. The walk a new project takes:
 * Use releases, the note's link to the roadmap, and the first release with
 * Enter. What the row sends, the next row, a member and a sprint roadmap are
 * `Roadmap.test.tsx`.
 */
test("the first release is made on the roadmap the note links to", async ({ page }, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Releases"));
  await page.goto(`/p/${projectId}/settings/project`);
  await page.getByRole("switch", { name: "Use releases" }).click();
  await page.getByRole("link", { name: "Roadmap", exact: true }).click();

  await expect(page.getByTestId("roadmap-add")).toContainText("No release yet");
  const { today } = await boardOf(page, projectId);
  await page.getByRole("textbox", { name: "Name of the release" }).fill("1.0");
  await page.getByLabel("Target date of the release").fill(plus(today, 21));
  await page.getByLabel("Target date of the release").press("Enter");

  const rows = page.getByTestId("roadmap-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("1.0");
  await expect(page.getByTestId("roadmap-add")).toContainText("Add a release");
  await page.screenshot({ path: testInfo.outputPath("seen-first-release.png") });

  const release = (await boardOf(page, projectId)).properties.find((p) => p.name === "Release")!;
  expect(release.options.map((o) => o.name)).toEqual(["1.0"]);
});
