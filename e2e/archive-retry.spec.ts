import { expect, test, type Page } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

type Detail = {
  archivedAt: string | null;
  activity: { kind: string; data: Record<string, unknown> }[];
};

/** The task in full, read as the panel reads it. */
async function read(page: Page, taskId: string): Promise<Detail> {
  const answer = await page.request.get(`/api/tasks/${taskId}`);
  expect(answer.ok()).toBeTruthy();
  return ((await answer.json()) as { task: Detail }).task;
}

/** How many `archive` lines the history holds for one word. */
function lines(detail: Detail, action: string): number {
  return detail.activity.filter((a) => a.kind === "archive" && a.data.action === action).length;
}

async function makeTask(page: Page, projectId: string, title: string): Promise<string> {
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { task: { id: string } }).task.id;
}

/*
 * Both calls say what the task should be, not what to do to it. An agent that
 * lost the answer and called again is the ordinary case: the board is a
 * network away, and a retry must cost nothing.
 */
test.describe("Archiving twice", () => {
  test("keeps the first moment and writes one line", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Retry"));
    const taskId = await makeTask(page, projectId, "Ship the release image");

    expect((await page.request.post(`/api/tasks/${taskId}/archive`)).ok()).toBeTruthy();
    const first = await read(page, taskId);
    expect(first.archivedAt).not.toBeNull();

    const again = await page.request.post(`/api/tasks/${taskId}/archive`);
    expect(again.ok()).toBeTruthy();
    expect(await again.json()).toEqual({ ok: true });

    /* The moment a task went is the one thing its history has to keep, so the
       second call leaves it where it was and says nothing. */
    const after = await read(page, taskId);
    expect(after.archivedAt).toBe(first.archivedAt);
    expect(lines(after, "archived")).toBe(1);

    // And the same on the way back.
    expect((await page.request.delete(`/api/tasks/${taskId}/archive`)).ok()).toBeTruthy();
    const back = await page.request.delete(`/api/tasks/${taskId}/archive`);
    expect(back.ok()).toBeTruthy();
    expect(await back.json()).toEqual({ ok: true });

    const live = await read(page, taskId);
    expect(live.archivedAt).toBeNull();
    expect(lines(live, "restored")).toBe(1);
  });

  test("putting a live task back writes nothing", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Live"));
    const taskId = await makeTask(page, projectId, "It was never archived");

    const answer = await page.request.delete(`/api/tasks/${taskId}/archive`);
    expect(answer.ok()).toBeTruthy();
    expect(await answer.json()).toEqual({ ok: true });

    const detail = await read(page, taskId);
    expect(detail.archivedAt).toBeNull();
    expect(lines(detail, "restored")).toBe(0);
  });
});
