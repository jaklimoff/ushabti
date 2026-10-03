import { expect, test, type Page } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

/**
 * A sprint whose end has passed rolls by itself on the next read of the board:
 * what is over is archived, the rest moves on with a comment, and the
 * changelog says it ended. A dated select with the same past target waits for
 * a press.
 */

type Option = {
  id: string;
  name: string;
  targetAt: string | null;
  shippedAt: string | null;
};
type Board = {
  properties: { id: string; name: string; type: string; options: Option[] }[];
  tasks: { id: string; key: string; title: string; values: Record<string, unknown> }[];
  archived: { id: string; title: string }[];
};
type Detail = {
  comments: { body: string; byProject: boolean; author: unknown }[];
  activity: { kind: string; data: Record<string, unknown>; actor: unknown }[];
};

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

async function board(page: Page, projectId: string): Promise<Board> {
  const res = await page.request.get(`/api/projects/${projectId}/board`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Board;
}

async function detail(page: Page, taskId: string): Promise<Detail> {
  return ((await (await page.request.get(`/api/tasks/${taskId}`)).json()) as { task: Detail }).task;
}

test("an ended sprint rolls on the first read, and a second read changes nothing", async ({
  page,
}) => {
  await register(page);
  const project = unique("Roll");
  const projectId = await createProject(page, project);

  /* Sprints made in the future, so that no read rolls them while the tasks
     are put in. Their dates are moved into the past after. */
  const sprints = await page.request.post(`/api/projects/${projectId}/sprints`, {
    data: { length: 14, startAt: day(30) },
  });
  expect(sprints.status()).toBe(201);
  const version = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name: "Version", type: "select", options: ["v1", "v2"] },
  });
  expect(version.ok()).toBeTruthy();

  let read = await board(page, projectId);
  const sprint = read.properties.find((p) => p.name === "Sprint")!;
  const status = read.properties.find((p) => p.name === "Status")!;
  const done = status.options.find((o) => o.name === "Shipped")!;
  const backlog = status.options.find((o) => o.name === "Backlog")!;
  const release = read.properties.find((p) => p.name === "Version")!;
  const [first, second] = sprint.options;
  const [v1] = release.options;
  expect(
    (await page.request.patch(`/api/properties/${release.id}`, { data: { dated: true } })).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.patch(`/api/projects/${projectId}`, {
        data: { doneWhen: { propertyId: status.id, optionId: done.id } },
      })
    ).ok(),
  ).toBeTruthy();

  const task = async (title: string, values: Record<string, unknown>) => {
    const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title, values },
    });
    expect(res.ok()).toBeTruthy();
  };
  await task("Alpha", { [sprint.id]: first.id, [status.id]: backlog.id });
  await task("Bravo", { [sprint.id]: first.id, [status.id]: done.id });
  await task("Charlie", { [sprint.id]: first.id, [status.id]: backlog.id });
  await task("Delta", { [release.id]: v1.id, [status.id]: done.id });

  /* Sprint 1 ended a week ago; Sprint 2 holds today. v1 is as late. */
  for (const [option, startAt, targetAt] of [
    [first, day(-20), day(-7)],
    [second, day(-6), day(7)],
    [v1, null, day(-7)],
  ] as const) {
    const res = await page.request.patch(`/api/options/${option.id}`, {
      data: { startAt, targetAt },
    });
    expect(res.ok()).toBeTruthy();
  }

  /* ---- the first read rolls ----------------------------------------- */

  read = await board(page, projectId);
  const options = () => read.properties.find((p) => p.id === sprint.id)!.options;
  const rolled = options().find((o) => o.id === first.id)!;
  expect(rolled.shippedAt).toBe(day(-7));
  expect(options().find((o) => o.id === second.id)!.shippedAt).toBeNull();
  const moved = ["Alpha", "Charlie"].map((t) => read.tasks.find((x) => x.title === t)!);
  for (const t of moved) expect(t.values[sprint.id]).toBe(second.id);
  expect(read.tasks.map((t) => t.title)).not.toContain("Bravo");
  const bravo = read.archived.find((t) => t.title === "Bravo")!;
  expect(bravo).toBeTruthy();

  /* Each moved task says so, written by the project and not by a person. */
  for (const t of moved) {
    const d = await detail(page, t.id);
    expect(d.comments.map((c) => c.body)).toEqual([
      `Moved from ${first.name} to ${second.name} when ${first.name} ended.`,
    ]);
    expect(d.comments[0].byProject).toBe(true);
    expect(d.comments[0].author).toBeNull();
    const value = d.activity.find((a) => a.kind === "value" && a.data.rolled);
    expect(value?.actor).toBeNull();
  }
  /* The archived task carries the line a pressed Ship writes. */
  const archivedLine = (await detail(page, bravo.id)).activity.find((a) => a.kind === "archive");
  expect(archivedLine?.data).toMatchObject({ action: "archived", option: first.name });

  /* A dated select with a target in the past waits for a press. */
  const late = read.properties.find((p) => p.id === release.id)!.options[0];
  expect(late.shippedAt).toBeNull();
  expect(read.tasks.find((t) => t.title === "Delta")!.values[release.id]).toBe(v1.id);

  /* ---- a second read changes nothing -------------------------------- */

  const again = await board(page, projectId);
  expect(again.properties).toEqual(read.properties);
  expect(again.tasks.map((t) => [t.title, t.values])).toEqual(
    read.tasks.map((t) => [t.title, t.values]),
  );
  for (const t of moved) expect((await detail(page, t.id)).comments).toHaveLength(1);

  /* ---- the changelog says ended for a roll, shipped for a press ------ */

  const pressed = await page.request.post(`/api/options/${v1.id}/ship`, {
    data: { rest: "leave" },
  });
  expect(pressed.ok()).toBeTruthy();
  await page.goto(`/p/${projectId}/changelog`);
  const entry = (name: string) => page.getByTestId("changelog-entry").filter({ hasText: name });
  await expect(entry(first.name).getByTestId("changelog-day")).toHaveText(/^Ended /);
  await expect(entry("v1").getByTestId("changelog-day")).toHaveText(/^Shipped /);

  /* The panel names the project as the comment's author, not a removed user. */
  await page.goto(`/p/${projectId}?task=${moved[0].key}`);
  const comment = page.getByTestId("task-panel").getByTestId("comment");
  await expect(comment).toContainText(project);
  await expect(comment).toContainText("when Sprint 1 ended.");
  await expect(comment).not.toContainText("Removed user");
});

test("an unshipped sprint stays open until its target moves", async ({ page }) => {
  await register(page);
  const projectId = await createProject(page, unique("Reopen"));
  const sprints = await page.request.post(`/api/projects/${projectId}/sprints`, {
    data: { length: 14, startAt: day(30) },
  });
  expect(sprints.status()).toBe(201);
  const sprintId = (await board(page, projectId)).properties.find((p) => p.name === "Sprint")!.id;
  const first = (await board(page, projectId)).properties.find((p) => p.id === sprintId)!
    .options[0];
  const patch = async (data: Record<string, unknown>) =>
    expect((await page.request.patch(`/api/options/${first.id}`, { data })).ok()).toBeTruthy();
  const shippedAt = async () =>
    (await board(page, projectId)).properties
      .find((p) => p.id === sprintId)!
      .options.find((o) => o.id === first.id)!.shippedAt;

  await patch({ startAt: day(-20), targetAt: day(-7) });
  expect(await shippedAt()).toBe(day(-7));

  /* An admin reopens it: the reads that follow leave it open. */
  await patch({ shippedAt: null });
  expect(await shippedAt()).toBeNull();
  expect(await shippedAt()).toBeNull();

  /* A new target is a new end, and the roll takes it once that has passed. */
  await patch({ targetAt: day(-1) });
  expect(await shippedAt()).toBe(day(-1));
});
