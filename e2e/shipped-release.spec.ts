import { expect, test, type Page } from "@playwright/test";
import { card, column, createProject, register, unique } from "./helpers";

/**
 * A shipped release folds away wherever a shipped sprint does: no column on a
 * board grouped by it, and no button in the panel's picker unless the task
 * holds it. The filter fold and Settings are `Sprints.test.tsx`; Move past a
 * shipped release is `release-route.test.ts`.
 */

type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  views: { id: string; isDefault: boolean }[];
};

async function releaseBoard(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Shipped release"));
  const read = async (): Promise<Board> =>
    (await page.request.get(`/api/projects/${projectId}/board`)).json();

  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Release", type: "select", options: ["R1", "R2", "R3"] },
  });
  expect(made.ok()).toBeTruthy();
  const release = (await read()).properties.find((p) => p.name === "Release")!;
  const [r1, r2] = release.options;
  const dated = await page.request.patch(`/api/properties/${release.id}`, {
    data: { dated: true },
  });
  expect(dated.ok()).toBeTruthy();

  for (const [title, option] of [
    ["Old work", r1],
    ["Open work", r2],
  ] as const) {
    const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title, values: { [release.id]: option.id } },
    });
    expect(res.ok()).toBeTruthy();
  }

  /* Only an option with a target date ships; Leave keeps Old work on R1. */
  const targeted = await page.request.patch(`/api/options/${r1.id}`, {
    data: { targetAt: new Date().toISOString().slice(0, 10) },
  });
  expect(targeted.ok()).toBeTruthy();
  const shipped = await page.request.post(`/api/options/${r1.id}/ship`, {
    data: { rest: "leave" },
  });
  expect(shipped.ok()).toBeTruthy();

  const main = (await read()).views.find((v) => v.isDefault)!;
  const grouped = await page.request.patch(`/api/views/${main.id}`, {
    data: { groupById: release.id },
  });
  expect(grouped.ok()).toBeTruthy();
  return projectId;
}

test("a shipped release has no column and leaves the panel's picker", async ({
  page,
}, testInfo) => {
  const projectId = await releaseBoard(page);
  await page.goto(`/p/${projectId}`);

  /* R1 shipped, so its card sits in the one column that says no open release. */
  await expect(page.getByTestId("column-name")).toHaveText([/^R2$/, /^R3$/, /^No open release$/i]);
  await expect(column(page, "No open release").getByTestId("card")).toHaveText([/Old work/]);
  await page.screenshot({ path: testInfo.outputPath("seen-shipped-release-board.png") });

  const field = page.locator('[data-testid="task-panel"] [data-property="Release"]');
  const offered = () => field.getByRole("button").allTextContents();

  /* A task on an open release is offered only the open ones. */
  await card(page, "Open work").click();
  await expect(page.getByTestId("task-panel")).toContainText("Open work");
  await expect.poll(async () => (await offered()).map((t) => t.trim())).toEqual(["R2", "R3"]);
  await page.screenshot({ path: testInfo.outputPath("seen-shipped-release-picker.png") });
  await page.keyboard.press("Escape");

  /* A task that holds the shipped one keeps it, so the field never reads empty. */
  await card(page, "Old work").click();
  await expect(page.getByTestId("task-panel")).toContainText("Old work");
  await expect.poll(async () => (await offered()).map((t) => t.trim())).toEqual(["R1", "R2", "R3"]);
});
