import { expect, test, type Page } from "@playwright/test";
import { column, createProject, register, unique } from "./helpers";

/**
 * A sprint closes and a release ships. Closing archives nothing and writes no
 * changelog entry; it moves or leaves what is not over. A task can sit in a
 * sprint and a release at once, so the release decides when it leaves.
 */

type Option = { id: string; name: string; shippedAt: string | null };
type Board = {
  properties: { id: string; name: string; options: Option[] }[];
  views: { id: string; isDefault: boolean }[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
  archived: { id: string; title: string }[];
};

async function board(page: Page, projectId: string): Promise<Board> {
  const res = await page.request.get(`/api/projects/${projectId}/board`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Board;
}

/** Sprints and a dated Version, the main view grouped by sprint, and four tasks. */
async function sprintAndRelease(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Close"));
  expect(
    (
      await page.request.post(`/api/projects/${projectId}/sprints`, { data: { length: 14 } })
    ).status(),
  ).toBe(201);
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Version", type: "select", options: ["v1", "v2"] },
  });
  expect(made.ok()).toBeTruthy();

  const read = await board(page, projectId);
  const sprint = read.properties.find((p) => p.name === "Sprint")!;
  const version = read.properties.find((p) => p.name === "Version")!;
  const status = read.properties.find((p) => p.name === "Status")!;
  const done = status.options.find((o) => o.name === "Shipped")!;
  const backlog = status.options.find((o) => o.name === "Backlog")!;
  const [s1, s2] = sprint.options;
  const [v1, v2] = version.options;
  expect(
    (await page.request.patch(`/api/properties/${version.id}`, { data: { dated: true } })).ok(),
  ).toBeTruthy();
  expect(
    (await page.request.patch(`/api/options/${v1.id}`, { data: { targetAt: "2026-10-14" } })).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.patch(`/api/projects/${projectId}`, {
        data: { doneWhen: { propertyId: status.id, optionId: done.id } },
      })
    ).ok(),
  ).toBeTruthy();

  const task = async (title: string, values: Record<string, unknown>) =>
    expect(
      (
        await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title, values } })
      ).ok(),
    ).toBeTruthy();
  await task("Released", { [sprint.id]: s1.id, [version.id]: v1.id, [status.id]: done.id });
  await task("Waits for v2", { [sprint.id]: s1.id, [version.id]: v2.id, [status.id]: done.id });
  await task("Not done", { [sprint.id]: s1.id, [status.id]: backlog.id });
  await task("Stays put", { [sprint.id]: s2.id, [status.id]: backlog.id });

  const main = read.views.find((v) => v.isDefault)!;
  /* Grouping by a sprint starts on "is current"; Close wants the whole column. */
  await page.request.patch(`/api/views/${main.id}`, { data: { groupById: sprint.id } });
  expect(
    (await page.request.patch(`/api/views/${main.id}`, { data: { filters: { rules: [] } } })).ok(),
  ).toBeTruthy();
  return { projectId, main, sprint, version, s1, s2, v1, v2 };
}

test("closing a sprint archives nothing, and only a release reaches the changelog", async ({
  page,
}) => {
  const { projectId, main, sprint, version, s1, s2, v1, v2 } = await sprintAndRelease(page);

  /* Close moves the unfinished task on and keeps the finished ones. */
  await page.goto(`/p/${projectId}`);
  await column(page, s1.name)
    .getByRole("button", { name: `Close ${s1.name}` })
    .click();
  const ask = page.getByRole("alertdialog", { name: `Close ${s1.name}` });
  await expect(ask.getByTestId("ship-confirm")).toHaveText(
    `Close ${s1.name}? 2 tasks are over and stay. 1 task is not over. What happens to them?`,
  );
  const closed = page.waitForResponse((res) => res.url().endsWith("/ship"));
  await ask.getByRole("button", { name: "Move to the next option" }).click();
  const answer = await closed;
  expect(answer.ok()).toBeTruthy();
  expect(await answer.json()).toMatchObject({ archived: 0, moved: 1, rest: "next" });
  await expect(page.getByText(`Closed ${s1.name}: moved 1 task to ${s2.name}.`)).toBeVisible();

  let read = await board(page, projectId);
  expect(read.archived).toEqual([]);
  const valueOf = (title: string, id: string) =>
    read.tasks.find((t) => t.title === title)!.values[id];
  expect(valueOf("Released", sprint.id)).toBe(s1.id);
  expect(valueOf("Waits for v2", sprint.id)).toBe(s1.id);
  expect(valueOf("Not done", sprint.id)).toBe(s2.id);

  /* Leave keeps the rest where it is, and still archives nothing. */
  const left = await page.request.post(`/api/options/${s2.id}/ship`, { data: { rest: "leave" } });
  expect(left.ok()).toBeTruthy();
  expect(await left.json()).toMatchObject({ archived: 0, moved: 0, rest: "leave" });
  read = await board(page, projectId);
  expect(read.archived).toEqual([]);
  expect(valueOf("Stays put", sprint.id)).toBe(s2.id);
  expect(valueOf("Not done", sprint.id)).toBe(s2.id);

  /* Shipping the release archives what is over in it, as before. */
  const shipped = await page.request.post(`/api/options/${v1.id}/ship`, {
    data: { rest: "leave" },
  });
  expect(shipped.ok()).toBeTruthy();
  expect(await shipped.json()).toMatchObject({ archived: 1 });
  read = await board(page, projectId);
  expect(read.archived.map((t) => t.title)).toEqual(["Released"]);

  /* The changelog lists the release and neither sprint. */
  const log = await page.request.get(`/api/projects/${projectId}/changelog`);
  expect(log.ok()).toBeTruthy();
  const { changelog } = (await log.json()) as { changelog: { name: string }[] };
  expect(changelog.map((e) => e.name)).toEqual(["v1"]);

  /* A task in a closed sprint and an open release is still on the board. */
  await page.request.patch(`/api/views/${main.id}`, { data: { groupById: version.id } });
  await page.goto(`/p/${projectId}`);
  await expect(
    column(page, v2.name).getByTestId("card").filter({ hasText: "Waits for v2" }),
  ).toBeVisible();
});
