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
 * A Version select with four options: one open around today, one shipped,
 * one with no target date, and one with a target and nothing to start it by.
 */
async function versions(page: Page, projectId: string) {
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Version", type: "select", options: ["Beta", "Alpha", "Someday", "Ghost"] },
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

test.describe("A roadmap", () => {
  test("draws one bar per dated option, with the shipped below, and a line for today", async ({
    page,
  }) => {
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
  });

  test("starts a bar at its oldest task, and asks for a select", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Roadmap"));
    const { version } = await versions(page, projectId);
    const ghost = version.options.find((o) => o.name === "Ghost")!;
    const task = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "Haunt", values: { [version.id]: ghost.id } },
    });
    expect(task.status()).toBe(201);

    const assignee = (await boardOf(page, projectId)).properties.find(
      (p) => p.name === "Assignee",
    )!;
    const wrong = await page.request.post(`/api/projects/${projectId}/views`, {
      data: { name: "Bad", kind: "roadmap", groupById: assignee.id },
    });
    expect(wrong.status()).toBe(400);

    await addRoadmap(page, projectId);
    await expect(page.getByTestId("roadmap-row")).toHaveCount(3);
    await expect(page.getByTestId("roadmap-row").nth(1)).toContainText("Ghost");
    await expect(page.getByTestId("roadmap-row").nth(1)).toContainText("0 of 1 task done");
  });

  test("a shipped option keeps its start in its archived work, and a filter takes rows away", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Roadmap"));
    const { version, today } = await versions(page, projectId);
    const id = (name: string) => version.options.find((o) => o.name === name)!.id;

    /* Alpha loses its start date, and its one task is archived, as a ship does. */
    expect(
      (
        await page.request.patch(`/api/options/${id("Alpha")}`, { data: { startAt: null } })
      ).status(),
    ).toBe(200);
    const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "Done work", values: { [version.id]: id("Alpha") } },
    });
    const taskId = ((await made.json()) as { task: { id: string } }).task.id;
    expect((await page.request.post(`/api/tasks/${taskId}/archive`)).ok()).toBeTruthy();

    const board = (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
      archivedUnder: Record<string, { firstAt: string; count: number }>;
    };
    expect(board.archivedUnder[id("Alpha")]).toMatchObject({ count: 1 });
    expect(board.archivedUnder[id("Alpha")].firstAt.slice(0, 10) <= today).toBe(true);

    await addRoadmap(page, projectId);
    const alpha = page.getByTestId("roadmap-row").filter({ hasText: "Alpha" });
    await expect(alpha).toContainText("1 task archived");

    /* A rule on the roadmap's own property leaves only the rows it names. */
    const viewId = (
      (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
        views: { id: string; name: string }[];
      }
    ).views.find((v) => v.name === "Plan")!.id;
    const ruled = await page.request.patch(`/api/views/${viewId}`, {
      data: { filters: { rules: [{ propertyId: version.id, op: "is", values: [id("Beta")] }] } },
    });
    expect(ruled.status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId("roadmap-row")).toHaveCount(1);
    await expect(page.getByTestId("roadmap-row")).toContainText("Beta");
  });

  test("reads at phone width: the axis scrolls and the page does not", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await register(page);
    const projectId = await createProject(page, unique("Roadmap"));
    await versions(page, projectId);
    await addRoadmap(page, projectId);

    await expect(page.getByTestId("roadmap-row")).toHaveCount(2);
    await expect(page.getByTestId("roadmap-today")).toBeInViewport();
    const page_ = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(page_).toBe(0);
    const name = await page.getByTestId("roadmap-row").first().locator("div").first().boundingBox();
    expect(name!.width).toBeLessThan(130);
  });
});
