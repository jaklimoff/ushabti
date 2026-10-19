import { expect, test, type Page } from "@playwright/test";
import { backdateRun, createProject, gotoSettings, register, unique } from "./helpers";

/*
 * Home follows every project without a reload: one stream for all of them,
 * one read for a burst, and a look of its own while an agent is at work,
 * because going silent rings nothing.
 */

async function connectAgent(page: Page, projectId: string, name: string): Promise<string> {
  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill(name);
  await page.getByRole("button", { name: "Add agent" }).click();
  const box = page.getByTestId("agent-box").filter({ hasText: name });
  await box.getByRole("button", { name: "Connect" }).click();
  await box.getByRole("button", { name: "Make token" }).click();
  const token = (
    (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
  ).trim();
  expect(token).toMatch(/^ush_/);
  return token;
}

async function makeTask(page: Page, projectId: string, title: string): Promise<string> {
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } });
  expect(made.ok()).toBeTruthy();
  return ((await made.json()).task as { id: string }).id;
}

/**
 * Counts the reads of Home: a refresh asks the server for the page again. The
 * top bar's Home link prefetches the same page, which is not a read.
 */
function countReads(page: Page) {
  const reads = { count: 0 };
  page.on("request", (req) => {
    const url = new URL(req.url());
    const headers = req.headers();
    if (url.pathname !== "/projects" || headers["rsc"] !== "1") return;
    if (!headers["next-router-prefetch"]) reads.count += 1;
  });
  return reads;
}

test.describe("Home follows every project live", () => {
  test("a run on another project shows on Home through one stream, and a burst reads once", async ({
    page,
    request,
  }, testInfo) => {
    await register(page, "Live Watcher");
    const first = await createProject(page, unique("Harbour"));
    const second = await createProject(page, unique("Quay"));
    const token = await connectAgent(page, second, "Worker");

    const streams: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.pathname.endsWith("/stream")) streams.push(url.pathname);
    });
    const reads = countReads(page);

    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(
      page.locator(`[data-testid="project-card"] > a[href="/p/${first}"]`),
    ).toBeVisible();
    /* The read on `ready` comes and goes before the test starts counting. */
    await expect.poll(() => reads.count).toBe(1);
    await page.waitForTimeout(1000);
    reads.count = 0;

    const card = page.locator(`[data-testid="project-card"] > a[href="/p/${second}"]`);
    await expect(card.getByTestId("project-agents")).toHaveCount(0);

    const tasks = await Promise.all(
      ["One", "Two", "Three", "Four", "Five", "Six"].map((t) => makeTask(page, second, t)),
    );
    const started = await request.post(`/api/tasks/${tasks[0]}/run`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { goal: "Go" },
    });
    expect(started.ok()).toBeTruthy();

    await expect(card.getByTestId("project-agents")).toHaveText("Worker working");
    await page.waitForTimeout(1500);
    expect(reads.count).toBe(1);
    expect(streams).toEqual(["/api/home/stream"]);
    await page.screenshot({ path: testInfo.outputPath("seen-home-live.png") });
  });

  test("a run that falls silent shows on Home within a minute, with nothing else changing", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    await register(page, "Silence Watcher");
    const projectId = await createProject(page, unique("Silent"));
    const token = await connectAgent(page, projectId, "Worker");
    const run = await request.post(`/api/tasks/${await makeTask(page, projectId, "Go")}/run`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { goal: "Go" },
    });
    expect(run.ok()).toBeTruthy();
    const runId = (await run.json()).run.id as string;

    const reads = countReads(page);
    await page.goto("/projects");
    const card = page.locator(`[data-testid="project-card"] > a[href="/p/${projectId}"]`);
    await expect(card.getByTestId("project-agents")).toHaveText("Worker working");
    /* The read on `ready` is over before the run goes quiet, so only Home's
       own look can find it. */
    await expect.poll(() => reads.count).toBe(1);
    await page.waitForTimeout(1000);

    /* Past the six minutes that make a run silent, written straight to the
       table, so nothing rings. */
    await backdateRun(runId, 10);
    await expect(card.getByTestId("project-agents")).toHaveText("Worker silent", {
      timeout: 60_000,
    });
    await page.screenshot({ path: testInfo.outputPath("seen-home-silent.png") });
  });

  test("Home's stream is for people: an agent token is turned away", async ({ page, request }) => {
    await register(page, "Stream Keeper");
    const projectId = await createProject(page, unique("Kept"));
    const token = await connectAgent(page, projectId, "Worker");
    const said = await request.get("/api/home/stream", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(said.status()).toBe(403);
  });
});
