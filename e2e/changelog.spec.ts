import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;

type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  tasks: { id: string; title: string }[];
};

/** A key nobody else's run has, because the public address is the key. */
function freshKey(): string {
  return `C${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/** A token for a new agent of this project, made through the routes. */
async function agentToken(page: Page, projectId: string): Promise<string> {
  const agent = await page.request.post(`/api/projects/${projectId}/agents`, {
    data: { name: "Builder" },
  });
  expect(agent.ok()).toBeTruthy();
  const { agent: made } = (await agent.json()) as { agent: { id: string } };
  const token = await page.request.post(`/api/projects/${projectId}/agents/${made.id}/tokens`, {
    data: { name: "ci" },
  });
  expect(token.ok()).toBeTruthy();
  return ((await token.json()) as { secret: string }).secret;
}

/*
 * A project with a Version property: v1 shipped first, v2 shipped last, v3
 * not yet. One task of v1 is archived, as a ship would leave it. Set up
 * through the routes, because the changelog is what is under test.
 */
async function shippedProject(page: Page) {
  await register(page, "Hidden Person");
  const projectId = await createProject(page, unique("Changes"));
  const key = freshKey();
  expect((await page.request.patch(`/api/projects/${projectId}`, { data: { key } })).ok()).toBe(
    true,
  );
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Version", type: "select", options: ["v1", "v2", "v3"] },
  });
  expect(made.ok()).toBeTruthy();
  const board: Board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const version = board.properties.find((p) => p.name === "Version")!;
  const [v1, v2, v3] = version.options;

  const ship = async (id: string, data: Record<string, unknown>) =>
    expect((await page.request.patch(`/api/options/${id}`, { data })).ok()).toBeTruthy();
  await ship(v1.id, { shippedAt: "2026-09-01", note: "The **first** one." });
  await ship(v2.id, { shippedAt: "2026-10-01" });

  const task = async (title: string, option: string) => {
    const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title, values: { [version.id]: option } },
    });
    expect(res.ok()).toBeTruthy();
    return ((await res.json()) as { task: { id: string } }).task.id;
  };
  const first = await task("Alpha lands", v1.id);
  await task("Bravo lands", v1.id);
  await task("Charlie lands", v2.id);
  await task("Delta waits", v3.id);
  expect((await page.request.post(`/api/tasks/${first}/archive`)).ok()).toBeTruthy();

  return { projectId, key };
}

test.describe("The changelog", () => {
  test("lists the shipped options newest first, with their notes and tasks", async ({ page }) => {
    const { projectId } = await shippedProject(page);

    await page.goto(`/p/${projectId}`);
    await page.getByRole("link", { name: "Changelog", exact: true }).click();
    await page.waitForURL(`**/p/${projectId}/changelog`);

    const entries = page.getByTestId("changelog-entry");
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0).getByRole("heading")).toHaveText("v2");
    await expect(entries.nth(0)).toContainText("October 1, 2026");
    await expect(entries.nth(1).getByRole("heading")).toHaveText("v1");
    await expect(entries.nth(1)).toContainText("September 1, 2026");
    /* The note is markdown, drawn. */
    await expect(entries.nth(1).locator("strong")).toHaveText("first");
    /* The archived task is read, and the tasks keep the board order. */
    await expect(entries.nth(1).getByTestId("changelog-task")).toHaveText([
      /Alpha lands/,
      /Bravo lands/,
    ]);
    await expect(page.getByText("Delta waits")).toHaveCount(0);
  });

  test("answers an agent's token with the same data", async ({ page }) => {
    const { projectId, key } = await shippedProject(page);
    const token = await agentToken(page, projectId);
    const res = await page.request.get(`/api/projects/${projectId}/changelog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const { changelog } = (await res.json()) as {
      changelog: {
        name: string;
        shippedAt: string;
        note: string | null;
        tasks: { key: string; title: string }[];
      }[];
    };
    expect(changelog.map((e) => [e.name, e.shippedAt, e.note])).toEqual([
      ["v2", "2026-10-01", null],
      ["v1", "2026-09-01", "The **first** one."],
    ]);
    expect(changelog[1].tasks.map((t) => t.title)).toEqual(["Alpha lands", "Bravo lands"]);
    expect(changelog[1].tasks[0].key).toMatch(new RegExp(`^${key}-\\d+$`));
  });

  test("is reached from Project settings on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { projectId } = await shippedProject(page);

    /* The bar is full on a phone, so the link is off it. */
    await page.goto(`/p/${projectId}`);
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Changelog", exact: true })).toBeHidden();

    await gotoSettings(page, projectId, "project");
    await page.getByRole("link", { name: "Changelog", exact: true }).click();
    await page.waitForURL(`**/p/${projectId}/changelog`);
    await expect(page.getByTestId("changelog-entry")).toHaveCount(2);
  });

  test("is private until somebody makes it public", async ({ page, browser }) => {
    const { projectId, key } = await shippedProject(page);
    const address = `/changelog/${key.toLowerCase()}`;

    const stranger = await browser.newContext();
    const outside = await stranger.newPage();
    expect((await outside.goto(address))!.status()).toBe(404);

    await gotoSettings(page, projectId, "project");
    await page.getByRole("button", { name: "Make it public" }).click();
    await expect(page.getByTestId("public-changelog-link")).toHaveText(address);

    /* A stranger reads it with no session: no keys, no people, no links. */
    expect((await outside.goto(address))!.status()).toBe(200);
    await expect(outside.getByTestId("changelog-entry")).toHaveCount(2);
    await expect(outside.getByTestId("changelog-task").first()).toHaveText("Charlie lands");
    const body = await outside.locator("body").innerText();
    expect(body).not.toContain(`${key}-`);
    expect(body).not.toContain("Hidden Person");
    await expect(outside.locator(`a[href*="/p/"]`)).toHaveCount(0);

    /* And off again is off at once. */
    await page.getByRole("button", { name: "Make it private" }).click();
    await expect(page.getByTestId("public-changelog-link")).toHaveCount(0);
    expect((await outside.goto(address))!.status()).toBe(404);
    await stranger.close();
  });

  test("lets one project per key be public", async ({ page }) => {
    const { projectId: first, key } = await shippedProject(page);
    expect(
      (
        await page.request.patch(`/api/projects/${first}`, { data: { publicChangelog: true } })
      ).ok(),
    ).toBeTruthy();

    const second = await createProject(page, unique("Twin"));
    expect(
      (await page.request.patch(`/api/projects/${second}`, { data: { key } })).ok(),
    ).toBeTruthy();
    const refused = await page.request.patch(`/api/projects/${second}`, {
      data: { publicChangelog: true },
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe(
      `Another project with the key ${key} already has a public changelog.`,
    );
  });
});
