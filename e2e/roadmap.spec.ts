import { expect, test } from "@playwright/test";
import { formatDate } from "../src/lib/board";
import { createProject, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;

type Board = {
  today: string;
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  views: { id: string; name: string; kind: string; groupById: string | null }[];
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
      await expect(rows.nth(1)).toContainText("No tasks yet");
      await expect(rows.nth(2)).toContainText("Alpha");
      await expect(rows.nth(2)).toContainText("✓");
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

test("labels the shipped rows, and a bar's panel leads to its dates in Settings and back", async ({
  page,
}, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Shipped"));
  const { version } = await versions(page, projectId);
  await addRoadmap(page, projectId);

  /* The label sits between the last open row and the first shipped one. */
  const label = page.getByTestId("roadmap-shipped");
  await expect(label).toHaveText("Shipped · 1");
  const rows = page.getByTestId("roadmap-row");
  const above = (await rows.nth(1).boundingBox())!;
  const at = (await label.boundingBox())!;
  const below = (await rows.nth(2).boundingBox())!;
  expect(at.y).toBeGreaterThan(above.y);
  expect(at.y).toBeLessThan(below.y);

  await rows.filter({ hasText: "Beta" }).getByTestId("roadmap-bar").click();
  const link = page.getByTestId("roadmap-panel-settings");
  await expect(link).toHaveText("Dates are set in Settings →");
  await page.screenshot({ path: testInfo.outputPath("seen-roadmap-panel.png") });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/settings/properties\\?from=.+#prop-${version.id}$`));
  await expect(page.locator(`#prop-${version.id}`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("seen-roadmap-settings.png") });

  await page.getByRole("link", { name: "Back to Plan" }).click();
  await expect(page.getByTestId("roadmap-view")).toBeVisible();
  await expect(page.getByTestId("roadmap-shipped")).toHaveText("Shipped · 1");
});

test("draws no shipped label when nothing has shipped", async ({ page }) => {
  await register(page);
  const projectId = await createProject(page, unique("Open"));
  await datedVersions(page, projectId, {
    Soon: { start: -10, target: 4 },
    Later: { start: 5, target: 60 },
  });
  await addRoadmap(page, projectId);
  await expect(page.getByTestId("roadmap-row")).toHaveCount(2);
  await expect(page.getByTestId("roadmap-shipped")).toHaveCount(0);
});

/* A Version select whose options are dated so many days from today. */
async function datedVersions(
  page: Page,
  projectId: string,
  dates: Record<string, { start: number; target: number }>,
) {
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Version", type: "select", options: Object.keys(dates) },
  });
  expect(made.status()).toBe(201);
  const { today, properties } = await boardOf(page, projectId);
  const version = properties.find((p) => p.name === "Version")!;
  for (const option of version.options) {
    const { start, target } = dates[option.name];
    const patched = await page.request.patch(`/api/options/${option.id}`, {
      data: { startAt: plus(today, start), targetAt: plus(today, target) },
    });
    expect(patched.status()).toBe(200);
  }
}

test.describe("A roadmap on a laptop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("shows every release on open, says where each stands, and offers Ship on the ready one", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Laptop"));
    await datedVersions(page, projectId, {
      Old: { start: -40, target: -3 },
      Soon: { start: -10, target: 4 },
      Later: { start: 5, target: 60 },
    });
    await addRoadmap(page, projectId);
    await page.mouse.move(0, 0);

    const bars = page.getByTestId("roadmap-bar");
    await expect(bars).toHaveCount(3);
    for (const bar of await bars.all()) await expect(bar).toBeInViewport({ ratio: 1 });

    const row = (name: string) => page.getByTestId("roadmap-row").filter({ hasText: name });
    await expect(row("Old").getByTestId("roadmap-end")).toContainText("ended");
    await expect(row("Soon")).toContainText("· 4 days left");
    await expect(row("Later")).not.toContainText(/ended|left/);
    await expect(row("Old").getByTestId("roadmap-bar")).toHaveAttribute("aria-label", /ended/);
    await expect(row("Soon").getByTestId("roadmap-bar")).toHaveAttribute(
      "aria-label",
      /4 days left/,
    );

    /* Ship waits on a release that is not ready, until the row is pointed at. */
    await expect(row("Old").getByTestId("roadmap-ship")).toHaveCSS("opacity", "1");
    await expect(row("Soon").getByTestId("roadmap-ship")).toHaveCSS("opacity", "0");
    await expect(row("Later").getByTestId("roadmap-ship")).toHaveCSS("opacity", "0");
    await row("Later").hover();
    await expect(row("Later").getByTestId("roadmap-ship")).toHaveCSS("opacity", "1");
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath("seen-laptop-roadmap.png") });

    /* The add row is named after the property, and makes a dated option. */
    await page.getByTestId("roadmap-add").getByRole("button", { name: "New version" }).click();
    await page.getByRole("textbox", { name: "Name of the new version" }).fill("Next");
    const { today } = await boardOf(page, projectId);
    await page.getByLabel("Target date of the new version").fill(plus(today, 70));
    await page.getByLabel("Target date of the new version").press("Enter");
    await expect(page.getByTestId("roadmap-row")).toHaveCount(4);
    const version = (await boardOf(page, projectId)).properties.find((p) => p.name === "Version")!;
    expect(version.options.map((o) => o.name)).toEqual(["Old", "Soon", "Later", "Next"]);
  });

  test("scrolls a plan too long to fit, and a chip at the edge brings a bar into view", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Long"));
    await datedVersions(page, projectId, {
      Now: { start: -10, target: 20 },
      Far: { start: 380, target: 400 },
    });
    await addRoadmap(page, projectId);

    const far = page.getByTestId("roadmap-row").filter({ hasText: "Far" });
    await expect(page.getByTestId("roadmap-today")).toBeInViewport();
    await expect(far.getByTestId("roadmap-bar")).not.toBeInViewport();
    const chip = far.getByRole("button", { name: "Scroll to Far" });
    await expect(chip).toHaveText(/›$/);
    await page.screenshot({ path: testInfo.outputPath("seen-edge-chip.png") });
    await chip.click();
    await expect(far.getByTestId("roadmap-bar")).toBeInViewport({ ratio: 1 });
  });
});

/*
 * A release is made where releases are seen. The walk a new project takes:
 * Use releases on its tile in Properties, the roadmap it made, and the first
 * release with Enter. What the row sends, the next row, a member and a sprint roadmap are
 * `Roadmap.test.tsx`.
 */
test("the first release is made on the roadmap Use releases makes", async ({ page }, testInfo) => {
  await register(page);
  const projectId = await createProject(page, unique("Releases"));
  await page.goto(`/p/${projectId}/settings/properties`);
  const tile = page.getByTestId("role-tile").filter({ hasText: "The releases" });
  await tile.getByRole("button", { name: "Use releases" }).click();
  await expect(page.getByRole("button", { name: "Turn off the releases" })).toBeVisible();
  const roadmap = (await boardOf(page, projectId)).views.find((v) => v.kind === "roadmap")!;
  await page.goto(`/p/${projectId}?view=${roadmap.id}`);

  await expect(page.getByTestId("roadmap-add")).toContainText("No release yet");
  const { today } = await boardOf(page, projectId);
  await page.getByRole("textbox", { name: "Name of the new release" }).fill("1.0");
  await page.getByLabel("Target date of the new release").fill(plus(today, 21));
  await page.getByLabel("Target date of the new release").press("Enter");

  const rows = page.getByTestId("roadmap-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("1.0");
  await expect(page.getByTestId("roadmap-add")).toContainText("Add release");
  await page.screenshot({ path: testInfo.outputPath("seen-first-release.png") });

  const release = (await boardOf(page, projectId)).properties.find((p) => p.name === "Release")!;
  expect(release.options.map((o) => o.name)).toEqual(["1.0"]);
});

test.describe("A roadmap bar's end", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("drags to move the target date, and the date is saved", async ({ page }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Drag end"));
    await datedVersions(page, projectId, { Beta: { start: -10, target: 20 } });
    const { today } = await boardOf(page, projectId);
    await addRoadmap(page, projectId);

    const beta = page.getByTestId("roadmap-row").filter({ hasText: "Beta" });
    const bar = (await beta.getByTestId("roadmap-bar").boundingBox())!;
    const grip = (await beta.getByTestId("roadmap-grip").boundingBox())!;
    // Beta runs 31 days, from ten days ago to twenty days on.
    const day = bar.width / 31;
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 4 * day, y, { steps: 12 });
    // While it is held, the end says the day it will land on.
    await expect(beta.getByTestId("roadmap-end")).toContainText(formatDate(plus(today, 24)));
    await page.screenshot({ path: testInfo.outputPath("seen-held-end.png") });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const { properties } = await boardOf(page, projectId);
        return properties.find((p) => p.name === "Version")!.options[0];
      })
      .toMatchObject({ targetAt: plus(today, 24) });

    await page.reload();
    await expect(
      page.getByTestId("roadmap-row").filter({ hasText: "Beta" }).getByTestId("roadmap-end"),
    ).toContainText(formatDate(plus(today, 24)));
  });
});
