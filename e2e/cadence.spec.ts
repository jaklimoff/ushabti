import { expect, test, type Page } from "@playwright/test";
import { column, createProject, register, unique } from "./helpers";

/**
 * An iteration's cadence makes the next sprint. The unit tests hold the names
 * and the dates. Use sprints, the length box in Settings and what the routes
 * write are `sprint-route.test.ts` and the two `Sprints.test.tsx`; this walks
 * the one door that needs the whole system: Close on the last sprint.
 */

type Option = {
  id: string;
  name: string;
  startAt: string | null;
  targetAt: string | null;
  shippedAt: string | null;
};
type Board = {
  properties: {
    id: string;
    name: string;
    type: string;
    config: { cadence?: { length?: number } };
    options: Option[];
  }[];
  views: { id: string; isDefault: boolean }[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
};

async function board(page: Page, projectId: string): Promise<Board> {
  return (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as Board;
}

async function sprintOf(page: Page, projectId: string) {
  return (await board(page, projectId)).properties.find((p) => p.name === "Sprint")!;
}

const dates = (o: Option) => [o.name, o.startAt, o.targetAt];

/** Sprints set up through the route, from a fixed day, so the dates are known. */
async function sprintsFrom(page: Page, startAt: string, length = 14) {
  await register(page);
  const projectId = await createProject(page, unique("Cadence"));
  const res = await page.request.post(`/api/projects/${projectId}/sprints`, {
    data: { length, startAt },
  });
  expect(res.status()).toBe(201);
  return projectId;
}

test("shipping the last sprint makes the next one, and Move takes the rest there", async ({
  page,
}) => {
  const projectId = await sprintsFrom(page, "2036-10-05");
  let read = await board(page, projectId);
  const sprint = read.properties.find((p) => p.name === "Sprint")!;
  const status = read.properties.find((p) => p.name === "Status")!;
  const backlog = status.options.find((o) => o.name === "Backlog")!;
  const [, second] = sprint.options;

  const task = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title: "Alpha", values: { [sprint.id]: second.id, [status.id]: backlog.id } },
  });
  expect(task.ok()).toBeTruthy();
  const main = read.views.find((v) => v.isDefault)!;
  await page.request.patch(`/api/views/${main.id}`, { data: { groupById: sprint.id } });

  /* Sprint 2 is the last option, and still Move is offered. */
  await page.goto(`/p/${projectId}`);
  await column(page, "Sprint 2").getByRole("button", { name: "Close Sprint 2" }).click();
  const ship = page.waitForResponse((res) => res.url().endsWith("/ship"));
  await page
    .getByRole("alertdialog", { name: "Close Sprint 2" })
    .getByRole("button", { name: "Move to the next option" })
    .click();
  expect((await ship).ok()).toBeTruthy();
  await expect(
    column(page, "Sprint 3").getByTestId("card").filter({ hasText: "Alpha" }),
  ).toBeVisible();

  read = await board(page, projectId);
  const after = read.properties.find((p) => p.id === sprint.id)!;
  const third = after.options.find((o) => o.name === "Sprint 3")!;
  expect(dates(third)).toEqual(["Sprint 3", "2036-11-02", "2036-11-15"]);
  expect(read.tasks.find((t) => t.title === "Alpha")!.values[sprint.id]).toBe(third.id);

  /* Two presses at once: one ships, the other is refused, and one Sprint 4. */
  const [a, b] = await Promise.all([
    page.request.post(`/api/options/${third.id}/ship`, { data: { rest: "leave" } }),
    page.request.post(`/api/options/${third.id}/ship`, { data: { rest: "leave" } }),
  ]);
  expect([a.status(), b.status()].sort()).toEqual([200, 409]);
  const names = (await sprintOf(page, projectId)).options.map((o) => o.name);
  expect(names.filter((n) => n === "Sprint 4")).toHaveLength(1);
  expect(names).toEqual(["Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4"]);
});
