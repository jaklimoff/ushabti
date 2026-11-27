import { expect, test, type APIResponse, type Page } from "@playwright/test";
import type { Client } from "pg";
import { createProject, inDatabase, register, unique } from "./helpers";

/*
 * A row lock of the strong kind conflicts with the key share a foreign key
 * check takes. A move held the project and waited for a task, while a value
 * write held the task and waited for the project to log its feed line, and
 * Postgres killed one of them. Each case here holds one row on a second
 * connection, lets the app block on it, and then has that connection write a
 * row whose foreign key points at what the app holds. Both must go through.
 */

type Setup = { projectId: string; taskId: string; userId: string; assigneeId: string };

async function setUp(page: Page): Promise<Setup> {
  await register(page, "Lock Person");
  const projectId = await createProject(page, unique("Locks"));
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title: "Held" },
  });
  expect(made.status()).toBe(201);
  const taskId = (await made.json()).task.id as string;
  return inDatabase(async (c) => {
    const owner = await c.query<{ id: string }>(
      "select owner_id as id from projects where id = $1",
      [projectId],
    );
    const person = await c.query<{ id: string }>(
      "select id from properties where project_id = $1 and type = 'person' limit 1",
      [projectId],
    );
    return { projectId, taskId, userId: owner.rows[0].id, assigneeId: person.rows[0].id };
  });
}

/** Waits until some other backend is waiting on a lock this connection holds. */
async function blockedBy(holder: Client) {
  const { rows } = await holder.query<{ pid: number }>("select pg_backend_pid() as pid");
  const pid = rows[0].pid;
  await inDatabase(async (watch) => {
    await expect
      .poll(
        async () => {
          const r = await watch.query<{ n: number }>(
            "select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
            [pid],
          );
          return r.rows[0].n;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });
}

/**
 * Holds a row with `lock`, sends the request, and once the request waits on
 * the row, runs `write` on the same connection and commits. Every lock ends
 * in the `finally`, whatever happened.
 */
async function race(
  lock: [string, unknown[]],
  send: () => Promise<APIResponse>,
  write: [string, unknown[]],
): Promise<{ answer: APIResponse; wrote: number }> {
  return inDatabase(async (c) => {
    await c.query("set lock_timeout = '5s'");
    await c.query("begin");
    let answer: Promise<APIResponse> | undefined;
    try {
      await c.query(lock[0], lock[1]);
      answer = send();
      await blockedBy(c);
      const wrote = (await c.query(write[0], write[1])).rowCount ?? 0;
      await c.query("commit");
      return { answer: await answer, wrote };
    } finally {
      await c.query("rollback").catch(() => {});
      await answer?.catch(() => {});
    }
  });
}

test("a card moved while its row is held goes through while a feed line is written", async ({
  page,
}) => {
  const s = await setUp(page);
  const { answer, wrote } = await race(
    ["select 1 from tasks where id = $1 for no key update", [s.taskId]],
    () => page.request.post(`/api/tasks/${s.taskId}/move`, { data: {} }),
    [
      "insert into activity (project_id, task_id, kind) values ($1, $2, 'comment')",
      [s.projectId, s.taskId],
    ],
  );
  expect(answer.status()).toBe(200);
  expect(wrote).toBe(1);
});

test("a value written while its row is held goes through while a comment is written", async ({
  page,
}) => {
  const s = await setUp(page);
  const url = `/api/tasks/${s.taskId}/values/${s.assigneeId}`;
  const first = await page.request.put(url, { data: { value: s.userId } });
  expect(first.status()).toBe(200);
  const { answer, wrote } = await race(
    [
      "select 1 from task_values where task_id = $1 and property_id = $2 for no key update",
      [s.taskId, s.assigneeId],
    ],
    () => page.request.put(url, { data: { value: s.userId } }),
    [
      "insert into comments (task_id, author_id, body) values ($1, $2, 'Meanwhile')",
      [s.taskId, s.userId],
    ],
  );
  expect(answer.status()).toBe(200);
  expect(wrote).toBe(1);
});

test("a project dragged on Home goes through while its person writes a comment", async ({
  page,
}) => {
  const s = await setUp(page);
  const { answer, wrote } = await race(
    [
      "select 1 from project_members where project_id = $1 and user_id = $2 for no key update",
      [s.projectId, s.userId],
    ],
    () => page.request.patch(`/api/projects/${s.projectId}/position`, { data: { afterId: null } }),
    [
      "insert into comments (task_id, author_id, body) values ($1, $2, 'Meanwhile')",
      [s.taskId, s.userId],
    ],
  );
  expect(answer.status()).toBe(200);
  expect(wrote).toBe(1);
});
