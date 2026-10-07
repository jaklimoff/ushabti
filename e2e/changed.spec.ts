import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createProject, gotoSettings, inDatabase, register, unique } from "./helpers";

/**
 * A task's changed time says when a person or an agent last did something to
 * it. Each act below winds the clock back first, so a bump is seen however
 * fast the act runs, and a write that must not bump is seen not to.
 */
const LONG_AGO = "2020-01-02T03:04:05.000Z";

async function windBack(taskId: string) {
  await inDatabase((c) =>
    c.query("update tasks set updated_at = $1 where id = $2", [LONG_AGO, taskId]),
  );
}

async function changedAt(taskId: string): Promise<string> {
  const { rows } = await inDatabase((c) =>
    c.query<{ updated_at: Date }>("select updated_at from tasks where id = $1", [taskId]),
  );
  return rows[0].updated_at.toISOString();
}

type Act = { what: string; run: () => Promise<{ ok(): boolean; status(): number }> };

async function moves(taskId: string, act: Act) {
  await windBack(taskId);
  const answer = await act.run();
  expect(answer.ok(), `${act.what} answered ${answer.status()}`).toBeTruthy();
  expect(await changedAt(taskId), `${act.what} moves the changed time`).not.toBe(LONG_AGO);
}

async function leaves(taskId: string, act: Act) {
  await windBack(taskId);
  const answer = await act.run();
  expect(answer.ok(), `${act.what} answered ${answer.status()}`).toBeTruthy();
  expect(await changedAt(taskId), `${act.what} leaves the changed time`).toBe(LONG_AGO);
}

async function makeTask(page: Page, projectId: string, title: string) {
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } });
  expect(made.ok()).toBeTruthy();
  return ((await made.json()) as { task: { id: string } }).task.id;
}

type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
};

async function statusOf(request: APIRequestContext, projectId: string) {
  const board = (await (await request.get(`/api/projects/${projectId}/board`)).json()) as Board;
  return board.properties.find((p) => p.name === "Status")!;
}

test("everything a person does to a task moves its changed time", async ({ page }) => {
  await register(page, "Toucher");
  const projectId = await createProject(page, unique("Changed"));
  const r = page.request;
  const id = await makeTask(page, projectId, "Touched all over");
  const other = await makeTask(page, projectId, "The other one");
  const status = await statusOf(r, projectId);
  const doing = status.options.find((o) => o.name === "In Progress")!;

  await moves(id, {
    what: "a title",
    run: () => r.patch(`/api/tasks/${id}`, { data: { title: "Touched everywhere" } }),
  });
  await moves(id, {
    what: "a description",
    run: () => r.patch(`/api/tasks/${id}`, { data: { description: "Words." } }),
  });
  await moves(id, {
    what: "a value",
    run: () => r.put(`/api/tasks/${id}/values/${status.id}`, { data: { value: doing.id } }),
  });

  let commentId = "";
  await moves(id, {
    what: "a comment",
    run: async () => {
      const answer = await r.post(`/api/tasks/${id}/comments`, { data: { body: "Hello" } });
      commentId = (await answer.json()).comment.id;
      return answer;
    },
  });
  await moves(id, {
    what: "an edited comment",
    run: () => r.patch(`/api/comments/${commentId}`, { data: { body: "Hello again" } }),
  });
  await moves(id, {
    what: "a deleted comment",
    run: () => r.delete(`/api/comments/${commentId}`),
  });

  let itemId = "";
  await moves(id, {
    what: "a checklist item",
    run: async () => {
      const answer = await r.post(`/api/tasks/${id}/checklist`, { data: { text: "One" } });
      itemId = (await answer.json()).item.id;
      return answer;
    },
  });
  await moves(id, {
    what: "a checklist tick",
    run: () => r.patch(`/api/checklist/${itemId}`, { data: { done: true } }),
  });
  await moves(id, {
    what: "a checklist item taken away",
    run: () => r.delete(`/api/checklist/${itemId}`),
  });

  await moves(id, {
    what: "a blocker",
    run: () => r.post(`/api/tasks/${id}/blockers`, { data: { blockerId: other } }),
  });
  await moves(id, {
    what: "a blocker taken away",
    run: () => r.delete(`/api/tasks/${id}/blockers/${other}`),
  });
  await moves(id, {
    what: "a parent",
    run: () => r.put(`/api/tasks/${id}/parent`, { data: { parentId: other } }),
  });
  await moves(id, {
    what: "a parent taken away",
    run: () => r.delete(`/api/tasks/${id}/parent`),
  });

  await moves(id, { what: "an archive", run: () => r.post(`/api/tasks/${id}/archive`) });
  await moves(id, { what: "an unarchive", run: () => r.delete(`/api/tasks/${id}/archive`) });
  await moves(id, {
    what: "an archive of many",
    run: () => r.post(`/api/projects/${projectId}/archive`, { data: { taskIds: [id] } }),
  });
  await r.delete(`/api/tasks/${id}/archive`);
  await r.delete(`/api/tasks/${id}`);
  await moves(id, { what: "a restore", run: () => r.post(`/api/tasks/${id}/restore`) });

  /* A drag into another column writes a value, so it is a change. */
  const todo = status.options.find((o) => o.name === "Todo")!;
  await moves(id, {
    what: "a move to another column",
    run: () =>
      r.post(`/api/tasks/${id}/move`, {
        data: { afterId: other, values: { [status.id]: todo.id } },
      }),
  });

  /* The board hands the same moment on, for the panel and the search. */
  const board = (await (await r.get(`/api/projects/${projectId}/board`)).json()) as {
    tasks: { id: string; updatedAt: string }[];
  };
  expect(board.tasks.find((t) => t.id === id)?.updatedAt).toBe(await changedAt(id));
});

test("a drag inside a column, a run report, a beat and a deleted option do not", async ({
  page,
  request,
}) => {
  await register(page, "Watcher");
  const projectId = await createProject(page, unique("Unchanged"));
  const r = page.request;
  const id = await makeTask(page, projectId, "Left alone");
  const other = await makeTask(page, projectId, "Its neighbour");

  await leaves(id, {
    what: "a drag inside one column",
    run: () => r.post(`/api/tasks/${id}/move`, { data: { afterId: other } }),
  });

  /* A property somebody reshapes rewrites the value, and that is not a touch. */
  const status = await statusOf(r, projectId);
  const doing = status.options.find((o) => o.name === "In Progress")!;
  await r.put(`/api/tasks/${id}/values/${status.id}`, { data: { value: doing.id } });
  await leaves(id, { what: "a deleted option", run: () => r.delete(`/api/options/${doing.id}`) });

  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill("Reporter");
  await page.getByRole("button", { name: "Add agent" }).click();
  const agentBox = page.getByTestId("agent-box").filter({ hasText: "Reporter" });
  await agentBox.getByRole("button", { name: "Connect" }).click();
  await agentBox.getByRole("button", { name: "Make token" }).click();
  const token = (
    (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
  ).trim();
  const headers = {
    Authorization: `Bearer ${token}`,
    "x-forwarded-for": unique("198.51.100"),
  };

  const claimed = await request.post(`/api/tasks/${id}/run`, {
    headers,
    data: { goal: "Build it", step: "Starting" },
  });
  expect(claimed.ok()).toBeTruthy();
  const runId = (await claimed.json()).run.id as string;

  await leaves(id, {
    what: "a run report",
    run: () => request.patch(`/api/runs/${runId}`, { headers, data: { step: "Halfway" } }),
  });
  await leaves(id, {
    what: "a beat",
    run: () => request.patch(`/api/runs/${runId}`, { headers, data: { beat: true } }),
  });

  /* The same agent writing a comment is somebody doing something. */
  await moves(id, {
    what: "an agent's comment",
    run: () => request.post(`/api/tasks/${id}/comments`, { headers, data: { body: "Done." } }),
  });
});

test("a file added and taken away moves the changed time", async ({ page }) => {
  await register(page, "Filer");
  const projectId = await createProject(page, unique("Filed"));
  const r = page.request;
  const id = await makeTask(page, projectId, "Has a file");
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const asked = await r.post(`/api/tasks/${id}/attachments`, {
    data: { name: "dot.png", mime: "image/png", size: PNG.length },
  });
  // CI sets a bucket, so a 503 there is a fault and must fail, not skip.
  // eslint-disable-next-line playwright/no-skipped-test -- no bucket, nothing to upload to
  test.skip(
    !process.env.CI && asked.status() === 503,
    "This server has no bucket, so the file is not tested.",
  );
  const { id: fileId, uploadUrl, headers } = await asked.json();
  const reached = await fetch(new URL(uploadUrl).origin, { signal: AbortSignal.timeout(5_000) })
    .then(() => true)
    .catch(() => false);
  // eslint-disable-next-line playwright/no-skipped-test -- a dev server's store may be down
  test.skip(
    !process.env.CI && !reached,
    "The object store did not answer, so the file is not tested.",
  );
  await expect
    .poll(async () => (await r.put(uploadUrl, { headers, data: PNG })).status(), {
      timeout: 30_000,
    })
    .toBe(200);

  await moves(id, { what: "a file", run: () => r.post(`/api/attachments/${fileId}/ready`) });
  await moves(id, { what: "a file taken away", run: () => r.delete(`/api/attachments/${fileId}`) });
});

test("the panel says when the task was made, by whom, and when it changed", async ({ page }) => {
  await register(page, "Ana Maker");
  const projectId = await createProject(page, unique("Stamp"));
  const id = await makeTask(page, projectId, "Stamped");
  /* Made on a known day of this year, so the words can be read exactly: a
     day of another year would carry its year. */
  const year = new Date().getUTCFullYear();
  await inDatabase((c) =>
    c.query(
      "update tasks set created_at = $1, updated_at = now() - interval '2 hours' where id = $2",
      [`${year}-01-03T09:30:00.000Z`, id],
    ),
  );

  await page.goto(`/p/${projectId}?task=${id}`);
  const stamp = page.getByTestId("task-stamp");
  await expect(stamp).toHaveText("Made 3 Jan by Ana Maker·changed 2 hours ago");
  await expect(page.getByTestId("task-made")).toHaveAttribute("title", `3 Jan ${year}, 09:30 UTC`);
  await expect(page.getByTestId("task-changed")).toHaveAttribute("title", /UTC$/);

  /* A comment is a change, and the line hears it. */
  await page.getByTestId("comment-box").fill("A word");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(stamp).toContainText("changed just now");

  /* Nobody's account behind it: the line drops "by". */
  await inDatabase((c) => c.query("update tasks set created_by = null where id = $1", [id]));
  await page.reload();
  await expect(stamp).toHaveText(/^Made 3 Jan·changed /);
});
