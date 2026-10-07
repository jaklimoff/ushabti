import { expect, test, type Page } from "@playwright/test";
import { card, column, createProject, headerRoom, register, unique } from "./helpers";

/**
 * A sprint ends when a person presses Close, as a release ships by a press. One past
 * its end stays open on every read, its header says how long ago it ended,
 * and Close makes the next sprint from the length when none follows it.
 */

type Option = {
  id: string;
  name: string;
  startAt: string | null;
  targetAt: string | null;
  shippedAt: string | null;
};
type Board = {
  properties: { id: string; name: string; type: string; options: Option[] }[];
  views: { id: string; name: string; isDefault: boolean }[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
  archived: { id: string; title: string }[];
};

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

async function board(page: Page, projectId: string): Promise<Board> {
  const res = await page.request.get(`/api/projects/${projectId}/board`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Board;
}

/** A project with sprints, the main view grouped by them, and Sprint 1 a week past its end. */
async function ended(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Ended"));
  const made = await page.request.post(`/api/projects/${projectId}/sprints`, {
    data: { length: 14 },
  });
  expect(made.status()).toBe(201);
  const read = await board(page, projectId);
  const sprint = read.properties.find((p) => p.name === "Sprint")!;
  const [first, second] = sprint.options;
  for (const [option, startAt, targetAt] of [
    [first, day(-20), day(-7)],
    [second, day(-6), day(7)],
  ] as const) {
    const res = await page.request.patch(`/api/options/${option.id}`, {
      data: { startAt, targetAt },
    });
    expect(res.ok()).toBeTruthy();
  }
  const main = read.views.find((v) => v.isDefault)!;
  /* Grouping by a sprint starts on "is current"; Close wants the whole column. */
  await page.request.patch(`/api/views/${main.id}`, { data: { groupById: sprint.id } });
  const unfiltered = await page.request.patch(`/api/views/${main.id}`, {
    data: { filters: { rules: [] } },
  });
  expect(unfiltered.ok()).toBeTruthy();
  const task = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title: "Alpha", values: { [sprint.id]: first.id } },
  });
  expect(task.ok()).toBeTruthy();
  return { projectId, sprint, first, second };
}

test("a sprint past its end stays open, and the board read writes nothing", async ({ page }) => {
  const { projectId, sprint, first } = await ended(page);
  const cursor = (
    (await (await page.request.get(`/api/projects/${projectId}/activity`)).json()) as {
      now: string;
    }
  ).now;

  const before = await board(page, projectId);
  const again = await board(page, projectId);
  expect(again.properties).toEqual(before.properties);
  const options = again.properties.find((p) => p.id === sprint.id)!.options;
  expect(options.find((o) => o.id === first.id)!.shippedAt).toBeNull();
  expect(again.tasks.find((t) => t.title === "Alpha")!.values[sprint.id]).toBe(first.id);
  expect(again.archived).toEqual([]);

  /* Nothing was written while the board was read: the feed is empty after it. */
  await page.goto(`/p/${projectId}`);
  await expect(column(page, "Sprint 1")).toBeVisible();
  const feed = await page.request.get(
    `/api/projects/${projectId}/activity?after=${encodeURIComponent(cursor)}`,
  );
  expect(((await feed.json()) as { entries: unknown[] }).entries).toEqual([]);
});

test("the header says how long ago it ended, and Close makes the next sprint", async ({ page }) => {
  const { projectId, sprint, first, second } = await ended(page);
  /* With the next sprint gone, Sprint 1 has no open sprint after it. */
  expect((await page.request.delete(`/api/options/${second.id}`)).ok()).toBeTruthy();

  await page.goto(`/p/${projectId}`);
  const header = column(page, "Sprint 1");
  await expect(header.getByTestId("column-date")).toHaveText("Ended 7 days ago");
  await expect(header.getByTestId("column-date")).toHaveAttribute("title", `Target ${day(-7)}`);

  await header.getByRole("button", { name: "Close Sprint 1" }).click();
  const ship = page.waitForResponse((res) => res.url().endsWith("/ship"));
  await page
    .getByRole("alertdialog", { name: "Close Sprint 1" })
    .getByRole("button", { name: "Move to the next option" })
    .click();
  expect((await ship).ok()).toBeTruthy();
  await expect(
    column(page, "Sprint 2").getByTestId("card").filter({ hasText: "Alpha" }),
  ).toBeVisible();

  /* The new sprint follows on from the old one's end and lasts the length. */
  const read = await board(page, projectId);
  const made = read.properties.find((p) => p.id === sprint.id)!.options;
  expect(made.map((o) => [o.name, o.startAt, o.targetAt, o.shippedAt])).toEqual([
    ["Sprint 1", day(-20), day(-7), new Date().toISOString().slice(0, 10)],
    ["Sprint 2", day(-6), day(7), null],
  ]);
  expect(read.tasks.find((t) => t.title === "Alpha")!.values[sprint.id]).toBe(made[1].id);
  expect(first.id).toBe(made[0].id);
});

test("Unship reopens an ended sprint, and nothing closes it again", async ({ page }) => {
  const { projectId, sprint, first } = await ended(page);
  const shippedAt = async () =>
    (await board(page, projectId)).properties
      .find((p) => p.id === sprint.id)!
      .options.find((o) => o.id === first.id)!.shippedAt;

  const shipped = await page.request.post(`/api/options/${first.id}/ship`, {
    data: { rest: "leave" },
  });
  expect(shipped.ok()).toBeTruthy();
  expect(await shippedAt()).not.toBeNull();

  const unship = await page.request.patch(`/api/options/${first.id}`, {
    data: { shippedAt: null },
  });
  expect(unship.ok()).toBeTruthy();
  expect(await shippedAt()).toBeNull();
  expect(await shippedAt()).toBeNull();

  await page.goto(`/p/${projectId}`);
  const header = column(page, "Sprint 1");
  await expect(header.getByTestId("column-date")).toHaveText("Ended 7 days ago");
  await expect(header.getByRole("button", { name: "Close Sprint 1" })).toBeVisible();
  await page.reload();
  await expect(column(page, "Sprint 1").getByTestId("column-date")).toHaveText("Ended 7 days ago");
  expect(await shippedAt()).toBeNull();
});

test("the Sprint view keeps an ended sprint as current until it ships", async ({ page }) => {
  const { projectId, sprint, first, second } = await ended(page);
  const bravo = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title: "Bravo", values: { [sprint.id]: second.id } },
  });
  expect(bravo.ok()).toBeTruthy();

  /* The view Set up sprints made, with its "Sprint is current" rule left on. */
  const view = (await board(page, projectId)).views.find((v) => v.name === "Sprint")!;
  await page.goto(`/p/${projectId}?view=${view.id}`);
  await page
    .getByTestId("view-pill")
    .filter({ hasText: /^Sprint$/ })
    .click();
  await expect(page.getByRole("button", { name: "Sprint is current", exact: true })).toBeVisible();
  await expect(card(page, "Alpha")).toBeVisible();
  await expect(card(page, "Bravo")).toHaveCount(0);

  /* Grouped by Sprint, the ended sprint is the column, and says so. */
  const grouped = await page.request.patch(`/api/views/${view.id}`, {
    data: { groupById: sprint.id },
  });
  expect(grouped.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sprint is current", exact: true })).toBeVisible();
  await expect(column(page, "Sprint 1").getByTestId("column-date")).toHaveText("Ended 7 days ago");
  await expect(column(page, "Sprint 2")).toHaveCount(0);

  /* Once it ships, the next sprint is current, and the rest went with it. */
  const shipped = await page.request.post(`/api/options/${first.id}/ship`, {
    data: { rest: "next" },
  });
  expect(shipped.ok()).toBeTruthy();
  await page.reload();
  await expect(column(page, "Sprint 1")).toHaveCount(0);
  const next = column(page, "Sprint 2");
  await expect(next.getByTestId("column-date")).not.toHaveText(/Ended/);
  await expect(next.getByTestId("card")).toHaveCount(2);
});

test("an ended header leaves the name readable with the sum, archive and Close showing", async ({
  page,
}) => {
  const { projectId, first } = await ended(page);

  /* Twelve days is the longest the words usually run; a sum needs a number. */
  const dated = await page.request.patch(`/api/options/${first.id}`, {
    data: { startAt: day(-26), targetAt: day(-12) },
  });
  expect(dated.ok()).toBeTruthy();
  const points = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Points", type: "number" },
  });
  expect(points.ok()).toBeTruthy();
  const pointsId = (await board(page, projectId)).properties.find((p) => p.name === "Points")!.id;
  const counted = await page.request.patch(`/api/projects/${projectId}`, {
    data: { progressBy: pointsId },
  });
  expect(counted.ok()).toBeTruthy();

  await page.goto(`/p/${projectId}`);
  const header = column(page, "Sprint 1");
  await expect(header.getByTestId("column-date")).toHaveText("Ended 12 days ago");
  await expect(header.getByTestId("column-sum")).toBeVisible();
  await expect(header.getByTestId("column-archive")).toBeVisible();
  await expect(header.getByTestId("column-ship")).toBeVisible();

  const room = await headerRoom(header);
  expect(room.past).toBe(0);
  expect(room.nameCut).toBeLessThanOrEqual(0);
});
