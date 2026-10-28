import { expect, test, type Page } from "@playwright/test";
import { addTask, card, createProject, gotoSettings, register, unique } from "./helpers";

/*
 * The sidebar names every project of the person on every signed-in page, says
 * live where an agent works and what waits, and is the one way to switch.
 * What a square and a row say, the keys and the phone's sheet are
 * `Sidebar.test.tsx`; this walks the real pages, the real stream and the
 * cookie the server reads.
 */

const sidebar = (page: Page) => page.getByTestId("sidebar");
const square = (page: Page, projectId: string) =>
  page.getByTestId("sidebar-project").and(page.locator(`[href="/p/${projectId}"]`));

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

/** Two projects, so the sidebar is drawn. The second one made is open. */
async function twoProjects(page: Page) {
  const other = await createProject(page, unique("Harbour"));
  const open = await createProject(page, unique("Lantern"));
  return { other, open };
}

/* Every stream the page opens, and whether it is still open. */
async function watchStreams(page: Page) {
  await page.addInitScript(() => {
    const Real = window.EventSource;
    const seen: { url: string; open: boolean }[] = [];
    (window as unknown as { streams: typeof seen }).streams = seen;
    window.EventSource = class extends Real {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        const one = { url: new URL(String(url), location.href).pathname, open: true };
        seen.push(one);
        const close = this.close.bind(this);
        this.close = () => {
          one.open = false;
          close();
        };
      }
    };
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { streams: { url: string; open: boolean }[] }).streams,
    );
}

test.describe("The sidebar", () => {
  test("is on every signed-in page and on no sign-in page", async ({ page, browser }, testInfo) => {
    await register(page, "Everywhere");
    const { open } = await twoProjects(page);
    expect((await page.request.post(`/api/projects/${open}/releases`)).ok()).toBe(true);
    const list = await page.request.post("/api/lists", { data: { projectId: open } });
    expect(list.ok()).toBeTruthy();
    const listId = ((await list.json()).list as { id: string }).id;

    for (const path of [
      "/projects",
      `/p/${open}`,
      `/p/${open}/settings/properties`,
      `/p/${open}/archived`,
      `/p/${open}/changelog`,
      "/account",
      `/lists/${listId}`,
    ]) {
      await page.goto(path);
      await expect(sidebar(page), path).toBeVisible();
      /* It sits on the left, the page beside it. */
      expect((await sidebar(page).boundingBox())?.x, path).toBe(0);
    }

    /* The project name is words, and Back to board is the way back. */
    for (const path of [
      `/p/${open}/settings/properties`,
      `/p/${open}/archived`,
      `/p/${open}/changelog`,
    ]) {
      await page.goto(path);
      await expect(page.getByTestId("project-switcher")).toHaveCount(0);
      await expect(page.getByTestId("project-crumb")).toBeVisible();
      expect(
        await page.getByTestId("project-crumb").evaluate((el) => el.closest("a, button")),
      ).toBeNull();
      await expect(page.getByRole("link", { name: "Back to board" })).toHaveAttribute(
        "href",
        `/p/${open}`,
      );
    }
    await page.goto(`/p/${open}`);
    expect(
      await page.getByTestId("board-crumb").evaluate((el) => el.closest("a, button")),
    ).toBeNull();
    await page.screenshot({ path: testInfo.outputPath("seen-sidebar-board.png") });

    const stranger = await browser.newPage();
    for (const path of ["/login", "/register", "/forgot"]) {
      await stranger.goto(path);
      await expect(stranger.locator("form").first(), path).toBeVisible();
      await expect(sidebar(stranger), path).toHaveCount(0);
    }
    await stranger.close();
  });

  test("moving between pages keeps one stream and the same sidebar", async ({ page }) => {
    const streams = await watchStreams(page);
    await register(page, "One Stream");
    const { other, open } = await twoProjects(page);

    await page.goto("/projects");
    await expect(sidebar(page)).toBeVisible();
    await expect.poll(async () => (await streams()).filter((s) => s.open)).toHaveLength(1);
    /* The same element all the way: a sidebar drawn again would lose this. */
    await sidebar(page).evaluate((el) => el.setAttribute("data-kept", "yes"));

    const opened = async () => (await streams()).filter((s) => s.open).map((s) => s.url);
    await square(page, open).click();
    await page.waitForURL(`**/p/${open}`);
    await expect.poll(opened).toEqual([`/api/projects/${open}/stream`]);
    await square(page, other).click();
    await page.waitForURL(`**/p/${other}`);
    await expect.poll(opened).toEqual([`/api/projects/${other}/stream`]);
    await page.getByTestId("top-bar").getByRole("link", { name: "Settings", exact: true }).click();
    await page.waitForURL(`**/p/${other}/settings/**`);
    /* Settings holds the project's stream too, and lends it. */
    await expect.poll(opened).toEqual([`/api/projects/${other}/stream`]);
    await sidebar(page).getByRole("link", { name: "Home", exact: true }).click();
    await page.waitForURL("**/projects");
    await expect.poll(opened).toEqual(["/api/home/stream"]);
    /* Home held one stream each time it was open, and nothing else did. */
    const all = await streams();
    expect(all.at(-1)?.open).toBe(true);
    expect(all.filter((s) => s.url === "/api/home/stream")).toHaveLength(2);
    await expect(sidebar(page)).toHaveAttribute("data-kept", "yes");
  });

  test("a dot comes within seconds of an agent starting, and an amber count says what waits", async ({
    page,
    request,
  }, testInfo) => {
    await register(page, "Watcher");
    const { other, open } = await twoProjects(page);
    const token = await connectAgent(page, other, "Builder");
    const agent = { Authorization: `Bearer ${token}` };
    const task = await makeTask(page, other, "Go");

    await page.goto(`/p/${open}`);
    await expect(sidebar(page)).toBeVisible();
    await expect(square(page, other).getByTestId("sidebar-dot")).toHaveCount(0);
    await expect(square(page, other)).toHaveAttribute(
      "aria-label",
      /: (Changed .+|No changes yet)$/,
    );

    const started = await request.post(`/api/tasks/${task}/run`, {
      headers: agent,
      data: { goal: "Go" },
    });
    expect(started.ok()).toBeTruthy();
    const runId = ((await started.json()).run as { id: string }).id;
    /* The board's own stream rings `elsewhere`; no reload. */
    await expect(square(page, other).getByTestId("sidebar-dot")).toBeVisible({ timeout: 5000 });
    await expect(square(page, other)).toHaveAttribute(
      "aria-label",
      /: Builder on [A-Z0-9]+-\d+ · \d+s$/,
    );

    /* The tip names it on hover. */
    await square(page, other).hover();
    await expect(square(page, other).getByTestId("sidebar-tip")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-sidebar-tip.png") });

    /* It asks: the count comes, and waiting outranks working in the line. */
    expect(
      (
        await request.patch(`/api/runs/${runId}`, {
          headers: agent,
          data: { status: "waiting", step: "Which?" },
        })
      ).ok(),
    ).toBeTruthy();
    await expect(square(page, other).getByTestId("sidebar-count")).toHaveText("1", {
      timeout: 5000,
    });
    await expect(square(page, other)).toHaveAttribute("aria-label", /: 1 waiting for you$/);

    /* Home draws no strip of its own while the sidebar says it. The sidebar
       is in the layout and comes first, so Home itself is waited for. */
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(page.getByTestId("project-card")).toHaveCount(2);
    await expect(square(page, other).getByTestId("sidebar-count")).toHaveText("1");
    const strip = page.getByTestId("home-waiting");
    await expect(strip).toHaveCount(1);
    await expect(strip).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("seen-sidebar-home.png") });
    /* A phone has the sidebar only as a sheet, so there the strip is drawn. */
    await page.setViewportSize({ width: 390, height: 780 });
    await expect(sidebar(page)).toBeHidden();
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("1 waiting for you");
    await page.screenshot({ path: testInfo.outputPath("seen-sidebar-home-phone.png") });
    await page.setViewportSize({ width: 1280, height: 720 });

    /* It finishes: the dot and the count go. */
    expect(
      (
        await request.patch(`/api/runs/${runId}`, { headers: agent, data: { status: "done" } })
      ).ok(),
    ).toBeTruthy();
    await expect(square(page, other).getByTestId("sidebar-count")).toHaveCount(0, {
      timeout: 5000,
    });
    await expect(square(page, other).getByTestId("sidebar-dot")).toHaveCount(0);
  });

  test("starts folded; the button and [ fold it, and the server paints the fold", async ({
    page,
  }, testInfo) => {
    await register(page, "Folder");
    const { open } = await twoProjects(page);
    const taskTitle = unique("Typed in");
    await addTask(page, "Backlog", taskTitle);

    await page.goto(`/p/${open}`);
    await expect(sidebar(page)).toHaveAttribute("data-folded", "true");
    expect((await sidebar(page).boundingBox())?.width).toBe(56);

    await page.getByTestId("sidebar-fold").click();
    await expect(sidebar(page)).toHaveAttribute("data-folded", "false");
    expect((await sidebar(page).boundingBox())?.width).toBe(248);
    await page.screenshot({ path: testInfo.outputPath("seen-sidebar-open.png") });

    /* The server reads the cookie, so the first paint is already open. */
    const html = await (await page.request.get(`/p/${open}`)).text();
    expect(html).toContain('data-folded="false"');
    await page.reload();
    await expect(sidebar(page)).toHaveAttribute("data-folded", "false");

    await page.locator("body").press("BracketLeft");
    await expect(sidebar(page)).toHaveAttribute("data-folded", "true");
    await page.locator("body").press("BracketLeft");
    await expect(sidebar(page)).toHaveAttribute("data-folded", "false");

    /* In a box it is a bracket and nothing else. */
    await card(page, taskTitle).first().click();
    const comment = page.getByTestId("comment-box");
    await comment.click();
    await page.keyboard.press("BracketLeft");
    await expect(sidebar(page)).toHaveAttribute("data-folded", "false");
  });

  test("is not drawn with one project and no list, and a second project brings it", async ({
    page,
  }) => {
    await register(page, "Alone");
    const only = await createProject(page, unique("Only"));
    await expect(page.getByTestId("top-bar")).toBeVisible();
    await expect(sidebar(page)).toHaveCount(0);

    await page.request.post("/api/projects", { data: { name: unique("Second") } });
    /* A move to another page asks again; no reload. */
    await page.getByTestId("top-bar").getByRole("link", { name: "Settings", exact: true }).click();
    await page.waitForURL(`**/p/${only}/settings/**`);
    await expect(sidebar(page)).toBeVisible();
  });

  test("a phone has it as a sheet from the project mark", async ({ page }, testInfo) => {
    await register(page, "Thumb");
    const { other, open } = await twoProjects(page);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(`/p/${open}`);
    await expect(page.getByTestId("top-bar")).toBeVisible();
    await expect(sidebar(page)).toBeHidden();

    await page.getByTestId("sidebar-sheet-open").click();
    const sheet = page.getByTestId("sidebar-sheet");
    await expect(sheet).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("seen-sidebar-sheet.png") });
    await sheet.locator(`[href="/p/${other}"]`).click();
    await page.waitForURL(`**/p/${other}`);
  });
});
