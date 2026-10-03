import { expect, test, type Page } from "@playwright/test";
import { column, createProject, gotoSettings, propertyBox, register, unique } from "./helpers";

/**
 * An iteration's cadence makes the next sprint. The unit tests hold the names
 * and the dates; this walks the three doors: Set up sprints, Ship, and the
 * two boxes in Settings.
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
    config: { cadence?: { length?: number; ahead?: number } };
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

test("Set up sprints asks for the length and the first day, and makes two sprints", async ({
  page,
}) => {
  await register(page);
  const projectId = await createProject(page, unique("Cadence"));
  await gotoSettings(page, projectId, "project");

  await expect(page.getByLabel("Sprint length in days")).toHaveValue("14");
  await page.getByLabel("Sprint length in days").fill("7");
  await page.getByLabel("First day of the first sprint").fill("2026-11-02");
  const answer = page.waitForResponse((res) => res.url().endsWith("/sprints"));
  await page.getByRole("button", { name: "Set up sprints" }).click();
  expect((await answer).status()).toBe(201);
  await expect(page.getByText("Sprints are set up.")).toBeVisible();

  const sprint = await sprintOf(page, projectId);
  expect(sprint.config.cadence).toEqual({ length: 7, ahead: 1 });
  expect(sprint.options.map(dates)).toEqual([
    ["Sprint 1", "2026-11-02", "2026-11-08"],
    ["Sprint 2", "2026-11-09", "2026-11-15"],
  ]);

  /* With nothing asked, the route takes 14 days from the project's today. */
  const other = await createProject(page, unique("Plain cadence"));
  expect((await page.request.post(`/api/projects/${other}/sprints`)).status()).toBe(201);
  const plain = await sprintOf(page, other);
  const today = new Date().toISOString().slice(0, 10);
  expect(plain.options[0].startAt).toBe(today);
  expect(plain.options).toHaveLength(2);

  /* A length that cannot be one is refused, and nothing is made. */
  const third = await createProject(page, unique("Bad cadence"));
  const bad = await page.request.post(`/api/projects/${third}/sprints`, { data: { length: 0 } });
  expect(bad.status()).toBe(400);
  expect((await board(page, third)).properties.map((p) => p.name)).not.toContain("Sprint");
});

test("shipping the last sprint makes the next one, and Move takes the rest there", async ({
  page,
}) => {
  const projectId = await sprintsFrom(page, "2026-10-05");
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
  await column(page, "Sprint 2").getByRole("button", { name: "Ship Sprint 2" }).click();
  const ship = page.waitForResponse((res) => res.url().endsWith("/ship"));
  await page
    .getByRole("alertdialog", { name: "Ship Sprint 2" })
    .getByRole("button", { name: "Move to the next option" })
    .click();
  expect((await ship).ok()).toBeTruthy();
  await expect(
    column(page, "Sprint 3").getByTestId("card").filter({ hasText: "Alpha" }),
  ).toBeVisible();

  read = await board(page, projectId);
  const after = read.properties.find((p) => p.id === sprint.id)!;
  const third = after.options.find((o) => o.name === "Sprint 3")!;
  expect(dates(third)).toEqual(["Sprint 3", "2026-11-02", "2026-11-15"]);
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

test("the cadence fills in after what an admin did by hand", async ({ page }) => {
  const projectId = await sprintsFrom(page, "2026-10-05");
  const [first, second] = (await sprintOf(page, projectId)).options;

  expect((await page.request.delete(`/api/options/${second.id}`)).ok()).toBeTruthy();
  expect(
    (
      await page.request.patch(`/api/options/${first.id}`, {
        data: { name: "Kickoff", targetAt: "2026-10-10" },
      })
    ).ok(),
  ).toBeTruthy();
  const shipped = await page.request.post(`/api/options/${first.id}/ship`, {
    data: { rest: "leave" },
  });
  expect(shipped.ok()).toBeTruthy();

  expect((await sprintOf(page, projectId)).options.map(dates)).toEqual([
    ["Kickoff", "2026-10-05", "2026-10-10"],
    ["Kickoff 2", "2026-10-11", "2026-10-24"],
  ]);
});

test("Settings shows the cadence, saved on blur and on leave", async ({ page, browser }) => {
  const projectId = await sprintsFrom(page, "2026-10-05");
  await gotoSettings(page, projectId);

  const box = propertyBox(page, "Sprint");
  const length = box.getByLabel("Sprint length in days of Sprint");
  const ahead = box.getByLabel("Sprints kept ahead of Sprint");
  await expect(length).toHaveValue("14");
  await expect(ahead).toHaveValue("1");

  /* A fill before React owns the box reaches no handler. */
  await expect
    .poll(() => length.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))))
    .toBe(true);
  const blur = page.waitForResponse((res) => res.request().method() === "PATCH");
  await length.fill("7");
  await length.blur();
  expect((await blur).ok()).toBeTruthy();
  await expect
    .poll(async () => (await sprintOf(page, projectId)).config.cadence)
    .toEqual({ length: 7, ahead: 1 });

  await ahead.fill("3");
  await expect(ahead).toBeFocused();
  await page.goto("about:blank");
  await expect
    .poll(async () => (await sprintOf(page, projectId)).config.cadence)
    .toEqual({ length: 7, ahead: 3 });

  /* A member writes values, never the cadence. */
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const member = await register(memberPage, "Bob Member");
  await page.request.post(`/api/projects/${projectId}/members`, {
    data: { email: member.email },
  });
  const sprint = await sprintOf(page, projectId);
  const refused = await memberPage.request.patch(`/api/properties/${sprint.id}`, {
    data: { cadence: { length: 3 } },
  });
  expect(refused.status()).toBe(403);
  await memberContext.close();
});
