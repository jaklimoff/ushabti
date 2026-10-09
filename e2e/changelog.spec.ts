import { expect, test } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;

type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  tasks: { id: string; title: string }[];
};

/** A key nobody else's run has, because the public address is the key. */
function freshKey(): string {
  return `C${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
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

/*
 * One shipped walk stays end to end: the board's link, the page and its
 * drawn note. The token, the public page, the shipped read and the key are
 * `release-route.test.ts`; the phone's way in and the button are
 * `ProjectPanel.test.tsx`.
 */
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
});
