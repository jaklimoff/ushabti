import { expect, test } from "@playwright/test";
import { card, column, createProject, inDatabase, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;

type Board = {
  properties: {
    id: string;
    name: string;
    type: string;
    options: { id: string; name: string; shippedAt: string | null }[];
  }[];
  views: { id: string; isDefault: boolean }[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
};

/*
 * A board grouped by Version, where v1 is due: three of its tasks are over
 * and one is not. v2 has no date, and v3 is the last option and dated, with
 * one task over and one not. Set up through the routes, because the header
 * is what is under test.
 */
async function releaseBoard(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Ship"));
  const read = async (): Promise<Board> =>
    (await page.request.get(`/api/projects/${projectId}/board`)).json();

  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Version", type: "select", options: ["v1", "v2", "v3"] },
  });
  expect(made.ok()).toBeTruthy();

  let board = await read();
  const status = board.properties.find((p) => p.name === "Status")!;
  const done = status.options.find((o) => o.name === "Shipped")!;
  const backlog = status.options.find((o) => o.name === "Backlog")!;
  const version = board.properties.find((p) => p.name === "Version")!;
  const [v1, v2, v3] = version.options;
  const dated = await page.request.patch(`/api/properties/${version.id}`, {
    data: { dated: true },
  });
  expect(dated.ok()).toBeTruthy();

  for (const option of [v1, v3]) {
    const res = await page.request.patch(`/api/options/${option.id}`, {
      data: { targetAt: "2026-10-14" },
    });
    expect(res.ok()).toBeTruthy();
  }

  const task = async (title: string, values: Record<string, unknown>) =>
    expect(
      (
        await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title, values } })
      ).ok(),
    ).toBeTruthy();
  await task("Alpha", { [version.id]: v1.id, [status.id]: done.id });
  await task("Bravo", { [version.id]: v1.id, [status.id]: done.id });
  await task("Charlie", { [version.id]: v1.id, [status.id]: backlog.id });
  await task("Delta", { [version.id]: v1.id, [status.id]: done.id });
  await task("Echo", { [version.id]: v3.id, [status.id]: done.id });
  await task("Foxtrot", { [version.id]: v3.id, [status.id]: backlog.id });

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
  return { projectId, read, version, v1, v2, v3 };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/*
 * Move stays end to end: it archives, moves on, writes the day and folds,
 * through the real board. The question, Clear, the refusals and Unship are
 * `Progress.test.tsx` and `release-route.test.ts`.
 */
test.describe("Ship on a column", () => {
  test("Move archives what is over, moves the rest on, writes the day and folds", async ({
    page,
  }) => {
    const { projectId, read, version, v1, v2 } = await releaseBoard(page);

    const v1Column = column(page, "v1");
    await v1Column.getByRole("button", { name: "Ship v1" }).click();
    await page
      .getByRole("alertdialog", { name: "Ship v1" })
      .getByRole("button", { name: "Move to the next option" })
      .click();

    await expect(page.getByTestId("column-strip").filter({ hasText: "v1" })).toBeVisible();
    await expect(column(page, "v2").getByText("Charlie")).toBeVisible();
    await expect(card(page, "Alpha")).toHaveCount(0);

    const board = await read();
    expect(board.tasks.map((t) => t.title).sort()).toEqual(["Charlie", "Echo", "Foxtrot"]);
    expect(board.tasks.find((t) => t.title === "Charlie")!.values[version.id]).toBe(v2.id);
    const shipped = board.properties
      .find((p) => p.id === version.id)!
      .options.find((o) => o.id === v1.id)!;
    expect(shipped.shippedAt).toBe(today());

    /* The shipped column offers no second ship. */
    await page.getByTestId("column-strip").filter({ hasText: "v1" }).click();
    await expect(column(page, "v1").getByTestId("column-ship")).toHaveCount(0);

    /* Every line of the ship shares one id: three archived, one moved, one
       on the project with the counts. */
    const lines = await inDatabase(async (client) => {
      const res = await client.query<{ kind: string; ship: string; task: string | null }>(
        `select kind, data->>'shipId' as ship, task_id as task from activity
          where project_id = $1 and data ? 'shipId'`,
        [projectId],
      );
      return res.rows;
    });
    expect(lines).toHaveLength(5);
    expect(new Set(lines.map((l) => l.ship)).size).toBe(1);
    expect(lines.filter((l) => l.kind === "archive" && l.task)).toHaveLength(3);
    expect(lines.filter((l) => l.kind === "value")).toHaveLength(1);
    expect(lines.filter((l) => l.task === null)).toHaveLength(1);

    /* A second ship of the same option is refused, and moves nothing. */
    const again = await page.request.post(`/api/options/${v1.id}/ship`, {
      data: { rest: "leave" },
    });
    expect(again.status()).toBe(409);
  });
});
