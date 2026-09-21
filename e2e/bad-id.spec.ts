import { expect, test, type APIResponse } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

/**
 * Every id on the board is a UUID. Postgres refuses to cast anything else, and
 * the refusal used to reach the caller as `500 Something went wrong on the
 * server.` — our fault, for a request that was merely wrong. One helper reads
 * the shape first, so every route that takes an id answers the same way.
 */

const BAD = "not-a-uuid";

/** The status and the sentence, as a caller reads them. */
async function said(answer: APIResponse): Promise<[number, string]> {
  const { error } = (await answer.json()) as { error: string };
  return [answer.status(), error];
}

test.describe("An id that is not a UUID", () => {
  test("is refused with a sentence, wherever it is in the path", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Bad id"));

    // A task.
    expect(await said(await page.request.get(`/api/tasks/${BAD}`))).toEqual([
      400,
      "That is not a task id.",
    ]);

    // A run.
    expect(await said(await page.request.get(`/api/runs/${BAD}`))).toEqual([
      400,
      "That is not a run id.",
    ]);

    // A view.
    expect(
      await said(await page.request.patch(`/api/views/${BAD}`, { data: { name: "Anything" } })),
    ).toEqual([400, "That is not a view id."]);

    /* A run's control word. This route reads the run by hand rather than
       through `runContext`, which is how it kept its 500 the first time. */
    expect(
      await said(
        await page.request.post(`/api/runs/${BAD}/control`, { data: { control: "pause" } }),
      ),
    ).toEqual([400, "That is not a run id."]);

    /* A lens. This route reads the view in one go, for the project and the
       rules at once, so it reads the id above that read rather than through
       `viewProjectId`. */
    expect(
      await said(await page.request.put(`/api/views/${BAD}/lens`, { data: { filters: null } })),
    ).toEqual([400, "That is not a view id."]);

    // And the project itself, which every project route reads through `guard`.
    expect(await said(await page.request.get(`/api/projects/${BAD}/board`))).toEqual([
      400,
      "That is not a project id.",
    ]);

    /* The second id in a path is read the same way. This is the main agent
       write, and it is the one the API page promises 400 for. */
    const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "Read the id first" },
    });
    expect(made.status()).toBe(201);
    const taskId = ((await made.json()) as { task: { id: string } }).task.id;

    expect(
      await said(await page.request.put(`/api/tasks/${taskId}/values/${BAD}`, { data: {} })),
    ).toEqual([400, "That is not a property id."]);
  });

  /* A body is a path the long way round. The bulk write names its tasks in
     one, so it reads them by the same shape and refuses the whole call. */
  test("is refused in a body as well", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Bad id body"));

    const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "Pick me" },
    });
    expect(made.status()).toBe(201);
    const taskId = ((await made.json()) as { task: { id: string } }).task.id;

    const answer = await page.request.post(`/api/projects/${projectId}/tasks/values`, {
      data: { taskIds: [taskId, BAD], propertyId: BAD, value: null },
    });
    expect(await said(answer)).toEqual([400, "Name the tasks as a list of ids."]);

    // And the property it names, which is one id rather than a list.
    const other = await page.request.post(`/api/projects/${projectId}/tasks/values`, {
      data: { taskIds: [taskId], propertyId: BAD, value: null },
    });
    expect(await said(other)).toEqual([400, "That is not a property id."]);
  });
});
