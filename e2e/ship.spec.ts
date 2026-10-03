import { expect, test } from "@playwright/test";
import {
  addFilter,
  card,
  column,
  createProject,
  gotoSettings,
  inDatabase,
  propertyBox,
  register,
  saved,
  unique,
} from "./helpers";

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

test.describe("Ship on a column", () => {
  test("only a dated column offers it, and it names both numbers", async ({ page }) => {
    await releaseBoard(page);

    /* The undated column is on screen, with its own buttons and no Ship. */
    const v2 = column(page, "v2");
    await expect(v2.getByRole("button", { name: "Fold the column v2" })).toBeVisible();
    await expect(v2.getByTestId("column-ship")).toHaveCount(0);
    await expect(column(page, "v1").getByTestId("column-ship")).toHaveCount(1);
    await expect(column(page, "v3").getByTestId("column-ship")).toHaveCount(1);

    const v1 = column(page, "v1");
    await v1.getByRole("button", { name: "Ship v1" }).click();
    /* The header becomes the question, so the column is found by it. */
    const ask = page.getByRole("alertdialog", { name: "Ship v1" });
    await expect(ask.getByTestId("ship-confirm")).toHaveText(
      "Ship v1? 3 tasks are over and will be archived. 1 task is not over. What happens to them?",
    );
    await expect(ask.getByRole("button")).toHaveText([
      "Move to the next option",
      "Leave them",
      "Clear the value",
      "Cancel",
    ]);

    /* Cancel asks nothing of the server. */
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    await expect(card(page, "Alpha")).toBeVisible();

    /* The last option has no next one, so Move is not offered. */
    const v3 = column(page, "v3");
    await v3.getByRole("button", { name: "Ship v3" }).click();
    await expect(page.getByRole("alertdialog", { name: "Ship v3" }).getByRole("button")).toHaveText(
      ["Leave them", "Clear the value", "Cancel"],
    );
  });

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

  test("Clear takes the value away; Leave keeps it", async ({ page }) => {
    const { read, version, v1, v3 } = await releaseBoard(page);

    const v3Column = column(page, "v3");
    await v3Column.getByRole("button", { name: "Ship v3" }).click();
    await page
      .getByRole("alertdialog", { name: "Ship v3" })
      .getByRole("button", { name: "Clear the value" })
      .click();
    await expect(page.getByTestId("column-strip").filter({ hasText: "v3" })).toBeVisible();
    let board = await read();
    expect(board.tasks.find((t) => t.title === "Foxtrot")!.values[version.id] ?? null).toBeNull();
    expect(board.tasks.some((t) => t.title === "Echo")).toBe(false);

    const leave = await page.request.post(`/api/options/${v1.id}/ship`, {
      data: { rest: "leave" },
    });
    expect(leave.ok()).toBeTruthy();
    expect(await leave.json()).toMatchObject({ archived: 3, moved: 0, rest: "leave" });
    board = await read();
    expect(board.tasks.find((t) => t.title === "Charlie")!.values[version.id]).toBe(v1.id);

    /* "next" on the last option is refused before anything moves. */
    const unshipped = await page.request.patch(`/api/options/${v3.id}`, {
      data: { shippedAt: null },
    });
    expect(unshipped.ok()).toBeTruthy();
    const last = await page.request.post(`/api/options/${v3.id}/ship`, { data: { rest: "next" } });
    expect(last.status()).toBe(400);
  });

  test("a filter or a member's role takes Ship away", async ({ page, browser }) => {
    const { projectId } = await releaseBoard(page);

    /* Under a rule the cards on screen are not the whole column, so the
       numbers in the question would not be the numbers that go. */
    await addFilter(page, "Status", "Backlog");
    await expect(
      column(page, "v1").getByRole("button", { name: "Fold the column v1" }),
    ).toBeVisible();
    await expect(column(page, "v1").getByTestId("column-ship")).toHaveCount(0);

    /* A member sees the dated column and no Ship: the route would refuse it. */
    const context = await browser.newContext();
    const memberPage = await context.newPage();
    const member = await register(memberPage, "Mo Member");
    const added = await page.request.post(`/api/projects/${projectId}/members`, {
      data: { email: member.email },
    });
    expect(added.ok()).toBeTruthy();
    await memberPage.goto(`/p/${projectId}`);
    const v1 = column(memberPage, "v1");
    await expect(v1.getByTestId("column-date")).toBeVisible();
    await expect(v1.getByTestId("column-ship")).toHaveCount(0);
    await context.close();
  });

  test("a token is refused, and an undated option cannot ship", async ({ page, request }) => {
    const { projectId, v1, v2 } = await releaseBoard(page);

    const token = await agentToken(page, projectId);
    const asAgent = await request.post(`/api/options/${v1.id}/ship`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { rest: "leave" },
    });
    expect(asAgent.status()).toBe(403);

    const undated = await page.request.post(`/api/options/${v2.id}/ship`, {
      data: { rest: "leave" },
    });
    expect(undated.status()).toBe(400);

    const nonsense = await page.request.post(`/api/options/${v1.id}/ship`, {
      data: { rest: "archive" },
    });
    expect(nonsense.status()).toBe(400);
    await expect(card(page, "Alpha")).toBeVisible();
  });

  test("Unship from Settings clears the day and leaves the archived tasks archived", async ({
    page,
  }) => {
    const { projectId, read, v1 } = await releaseBoard(page);
    const res = await page.request.post(`/api/options/${v1.id}/ship`, { data: { rest: "next" } });
    expect(res.ok()).toBeTruthy();

    await gotoSettings(page, projectId);
    const box = propertyBox(page, "Version");
    await box.getByRole("button", { name: "Unship v1" }).click();
    await saved(page, () => box.getByRole("button", { name: "Yes, unship" }).click());
    await expect(box.getByRole("button", { name: "Unship v1" })).toHaveCount(0);

    const board = await read();
    const version = board.properties.find((p) => p.name === "Version")!;
    expect(version.options.find((o) => o.id === v1.id)!.shippedAt).toBeNull();
    expect(board.tasks.map((t) => t.title).sort()).toEqual(["Charlie", "Echo", "Foxtrot"]);
  });
});
