import { expect, test } from "@playwright/test";
import { formatDate } from "../src/lib/board";
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

  test("starts the first bar at its oldest task, the next after it, and asks for a select", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Roadmap"));
    const { version, today } = await versions(page, projectId);
    const ghost = version.options.find((o) => o.name === "Ghost")!;
    const beta = version.options.find((o) => o.name === "Beta")!;
    const patch = (optionId: string, data: object) =>
      page.request.patch(`/api/options/${optionId}`, { data });
    expect((await patch(ghost.id, { targetAt: plus(today, 5) })).status()).toBe(200);
    expect((await patch(beta.id, { startAt: null })).status()).toBe(200);
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
    const rows = page.getByTestId("roadmap-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Ghost");
    await expect(rows.nth(0)).toContainText("0 of 1 task done");
    /* Ghost starts on the day its task was made; Beta the day after Ghost's target. */
    const bars = page.getByTestId("roadmap-bar");
    await expect(bars.nth(0)).toHaveAttribute(
      "title",
      `${formatDate(today)} – ${formatDate(plus(today, 5))}`,
    );
    await expect(rows.nth(1)).toContainText("Beta");
    await expect(bars.nth(1)).toHaveAttribute(
      "title",
      `${formatDate(plus(today, 6))} – ${formatDate(plus(today, 20))}`,
    );
  });

  test("a shipped option keeps its start in its archived work, and a filter takes rows away", async ({
    page,
  }) => {
    await register(page);
    const projectId = await createProject(page, unique("Roadmap"));
    const { version, today } = await versions(page, projectId);
    const id = (name: string) => version.options.find((o) => o.name === name)!.id;

    /* Alpha loses its start date, and its one task is archived, as a ship does.
       Ghost loses its target, so nothing dated comes before Alpha. */
    expect(
      (
        await page.request.patch(`/api/options/${id("Ghost")}`, { data: { targetAt: null } })
      ).status(),
    ).toBe(200);
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

  test("a bar opens its tasks in the panel, through the view's filters", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Roadmap"));
    const { version } = await versions(page, projectId);
    const id = (name: string) => version.options.find((o) => o.name === name)!.id;
    expect(
      (
        await page.request.patch(`/api/options/${id("Beta")}`, {
          data: { note: "Ship it **fast**" },
        })
      ).status(),
    ).toBe(200);
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Team", type: "select", options: ["Red", "Blue"] },
    });
    expect(made.status()).toBe(201);
    const team = (await boardOf(page, projectId)).properties.find((p) => p.name === "Team")!;
    const teamId = (name: string) => team.options.find((o) => o.name === name)!.id;

    async function task(title: string, values: Record<string, string>) {
      const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
        data: { title, values },
      });
      expect(res.status()).toBe(201);
      return ((await res.json()) as { task: { id: string } }).task.id;
    }
    await task("One", { [version.id]: id("Beta"), [team.id]: teamId("Red") });
    await task("Two", { [version.id]: id("Beta"), [team.id]: teamId("Blue") });
    await task("Three", { [version.id]: id("Beta"), [team.id]: teamId("Red") });
    const over = await task("Old work", { [version.id]: id("Alpha"), [team.id]: teamId("Blue") });
    expect((await page.request.post(`/api/tasks/${over}/archive`)).ok()).toBeTruthy();

    await addRoadmap(page, projectId);
    const viewId = (
      (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
        views: { id: string; name: string }[];
      }
    ).views.find((v) => v.name === "Plan")!.id;
    const ruled = await page.request.patch(`/api/views/${viewId}`, {
      data: { filters: { rules: [{ propertyId: team.id, op: "is", values: [teamId("Red")] }] } },
    });
    expect(ruled.status()).toBe(200);
    await page.reload();

    /* A click opens the name, the dates, the note and the tasks the bar fills from. */
    const beta = page.getByTestId("roadmap-bar").first();
    await beta.click();
    const panel = page.getByTestId("roadmap-panel");
    await expect(panel.getByRole("heading", { name: "Beta" })).toBeVisible();
    await expect(page.getByTestId("roadmap-panel-dates")).toContainText("–");
    await expect(page.getByTestId("roadmap-panel-note").locator("strong")).toHaveText("fast");
    await expect(page.getByTestId("roadmap-panel-task")).toHaveText([/One/, /Three/]);

    /* A row opens its task as the list does, and closing the task brings the list back. */
    await page.getByTestId("roadmap-panel-task").filter({ hasText: "Three" }).click();
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "Close task" }).click();
    await expect(panel).toBeVisible();

    /* Escape closes it, and the cursor is on the bar again. */
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(beta).toBeFocused();

    /* Enter opens it, and the ✕ closes it the same way. */
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close Beta" }).click();
    await expect(panel).toBeHidden();
    await expect(beta).toBeFocused();

    /* Space too. A shipped option lists its archived work, marked. */
    await page.keyboard.press(" ");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("roadmap-bar").nth(1).click();
    await expect(panel.getByRole("heading", { name: "Alpha" })).toBeVisible();
    await expect(page.getByTestId("roadmap-panel-dates")).toContainText("Shipped");
    const archived = page.getByTestId("roadmap-panel-task");
    await expect(archived).toHaveCount(1);
    await expect(archived).toContainText("Old work");
    await expect(archived).toContainText("Archived");

    /* A filter that takes the row away takes the panel for good: lifting the
       filter brings the row back, and not the panel. */
    const rule = (values: string[]) =>
      page.request.patch(`/api/views/${viewId}`, {
        data: { filters: { rules: [{ propertyId: version.id, op: "is", values }] } },
      });
    expect((await rule([id("Beta")])).status()).toBe(200);
    await expect(page.getByTestId("roadmap-bar")).toHaveCount(1);
    await expect(panel).toBeHidden();
    expect((await rule([id("Beta"), id("Alpha")])).status()).toBe(200);
    await expect(page.getByTestId("roadmap-bar")).toHaveCount(2);
    await expect(panel).toBeHidden();
  });

  test("at phone width a bar's panel lies over the roadmap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await register(page);
    const projectId = await createProject(page, unique("Roadmap"));
    await versions(page, projectId);
    await addRoadmap(page, projectId);

    await page.getByTestId("roadmap-bar").first().click();
    const panel = page.getByTestId("roadmap-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("No task is under Beta.");
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wide).toBe(0);
    await panel.getByRole("button", { name: "Close Beta" }).click();
    await expect(panel).toBeHidden();
  });
});
