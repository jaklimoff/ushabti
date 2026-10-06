import { expect, test } from "@playwright/test";
import {
  addFilter,
  column,
  createProject,
  gotoSettings,
  overflow,
  register,
  showColumn,
  unique,
  choose,
} from "./helpers";

type Page = import("@playwright/test").Page;

type Board = {
  properties: { id: string; name: string; type: string; options: { id: string; name: string }[] }[];
  views: { id: string; isDefault: boolean }[];
};

/*
 * A board grouped by Version reads as a release board: each dated column
 * says its day and how far it has come. Everything is set up through the
 * routes, because the header is what is under test.
 */
async function releaseBoard(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Release"));
  const read = async (): Promise<Board> =>
    (await page.request.get(`/api/projects/${projectId}/board`)).json();

  const made = async (data: object) => {
    const res = await page.request.post(`/api/projects/${projectId}/properties`, { data });
    expect(res.ok()).toBeTruthy();
  };
  await made({ name: "Version", type: "select", options: ["v1", "v2", "v3"] });
  await made({ name: "Points", type: "number" });

  let board = await read();
  const status = board.properties.find((p) => p.name === "Status")!;
  const done = status.options.find((o) => o.name === "Shipped")!;
  const backlog = status.options.find((o) => o.name === "Backlog")!;
  const version = board.properties.find((p) => p.name === "Version")!;
  const points = board.properties.find((p) => p.name === "Points")!;
  const [v1, , v3] = version.options;

  const dated = async (optionId: string, data: object) =>
    expect((await page.request.patch(`/api/options/${optionId}`, { data })).ok()).toBeTruthy();
  await dated(v1.id, { targetAt: "2026-10-14" });
  await dated(v3.id, { targetAt: "2026-09-01", shippedAt: "2026-09-30" });

  const task = async (title: string, values: Record<string, unknown>) =>
    expect(
      (
        await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title, values } })
      ).ok(),
    ).toBeTruthy();
  await task("Alpha", { [version.id]: v1.id, [status.id]: done.id, [points.id]: 13 });
  await task("Bravo", { [version.id]: v1.id, [status.id]: done.id, [points.id]: 8 });
  await task("Charlie", { [version.id]: v1.id, [status.id]: backlog.id, [points.id]: 13 });
  await task("Delta", { [version.id]: v1.id, [status.id]: done.id });
  await task("Echo", { [version.id]: v3.id, [status.id]: done.id });

  const project = await page.request.patch(`/api/projects/${projectId}`, {
    data: { doneWhen: { propertyId: status.id, optionId: done.id } },
  });
  expect(project.ok()).toBeTruthy();

  board = await read();
  const main = board.views.find((v) => v.isDefault)!;
  const grouped = await page.request.patch(`/api/views/${main.id}`, {
    data: { groupById: version.id },
  });
  expect(grouped.ok()).toBeTruthy();

  await page.goto(`/p/${projectId}`);
  await expect(column(page, "v1")).toBeVisible();
  return { projectId };
}

test.describe("A dated column reads as a release", () => {
  test("it shows its day and a bar of the tasks that are over, under the filters", async ({
    page,
  }) => {
    await releaseBoard(page);

    const v1 = column(page, "v1");
    await expect(v1.getByTestId("column-date")).toHaveText("Oct 14");
    const bar = v1.getByTestId("column-progress");
    await expect(bar).toHaveAttribute("aria-valuenow", "3");
    await expect(bar).toHaveAttribute("aria-valuemax", "4");
    await expect(bar).toHaveAttribute("aria-label", "3 of 4 tasks done");
    /* Counting tasks says nothing new in words: the count already says it. */
    await expect(v1.getByTestId("column-sum")).toHaveCount(0);

    /* An option with no date shows nothing new. */
    const v2 = column(page, "v2");
    await expect(v2.getByTestId("column-date")).toHaveCount(0);
    await expect(v2.getByTestId("column-progress")).toHaveCount(0);

    /* A shipped date takes the target's place. */
    const v3 = column(page, "v3");
    await expect(v3.getByTestId("column-date")).toHaveText("✓ Sep 30");
    /* One task is one task, not one tasks. */
    await expect(v3.getByTestId("column-progress")).toHaveAttribute(
      "aria-label",
      "1 of 1 task done",
    );

    /* The filter narrows both numbers, so the bar agrees with the cards. */
    await addFilter(page, "Status", "Backlog");
    await expect(bar).toHaveAttribute("aria-valuenow", "0");
    await expect(bar).toHaveAttribute("aria-valuemax", "1");
  });

  test("counted by a number property, the header says how much in that unit", async ({ page }) => {
    const { projectId } = await releaseBoard(page);

    await gotoSettings(page, projectId, "project");
    const box = page.getByLabel("Count progress by");
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(`/api/projects/${projectId}`) && r.request().method() === "PATCH",
      ),
      choose(box, "Points"),
    ]);
    await expect(box).toHaveAttribute("data-value", /.+/);

    await page.goto(`/p/${projectId}`);
    const v1 = column(page, "v1");
    await expect(v1.getByTestId("column-sum")).toHaveText("21 of 34");
    await expect(v1.getByTestId("column-progress")).toHaveAttribute(
      "aria-label",
      "21 of 34 Points done",
    );

    /* Back to tasks, and the words go. */
    await gotoSettings(page, projectId, "project");
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(`/api/projects/${projectId}`) && r.request().method() === "PATCH",
      ),
      choose(page.getByLabel("Count progress by"), "Tasks"),
    ]);
    await page.goto(`/p/${projectId}`);
    await expect(column(page, "v1").getByTestId("column-sum")).toHaveCount(0);
  });

  test("a name that is not a number property is refused", async ({ page }) => {
    const { projectId } = await releaseBoard(page);
    const board: Board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const version = board.properties.find((p) => p.name === "Version")!;
    const res = await page.request.patch(`/api/projects/${projectId}`, {
      data: { progressBy: version.id },
    });
    expect(res.status()).toBe(400);
  });

  test("the header with its date and sum reads at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    const { projectId } = await releaseBoard(page);
    const points = (
      (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as Board
    ).properties.find((p) => p.name === "Points")!;
    await page.request.patch(`/api/projects/${projectId}`, { data: { progressBy: points.id } });
    await page.reload();

    await showColumn(page, "v1");
    const v1 = column(page, "v1");
    const date = v1.getByTestId("column-date");
    const sum = v1.getByTestId("column-sum");
    await expect(date).toHaveText("Oct 14");
    await expect(sum).toHaveText("21 of 34");
    await expect(v1.getByTestId("column-progress")).toBeVisible();
    await expect(v1.getByTestId("column-name")).toBeVisible();

    /* Nothing leaves the column: the date and the sum sit inside its edges. */
    const edge = (await v1.boundingBox())!;
    for (const part of [date, sum]) {
      const at = (await part.boundingBox())!;
      expect(at.x).toBeGreaterThanOrEqual(edge.x);
      expect(at.x + at.width).toBeLessThanOrEqual(edge.x + edge.width);
    }
    expect(await overflow(page)).toBe(0);
  });
});
