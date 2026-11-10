import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createProject, inDatabase, register, unique } from "./helpers";

/*
 * A second server of the same production build, with a pool of five, on the
 * suite's database. Its connections carry a name of their own, so the test
 * can count them. The suite's own server keeps its pool, so nothing else in
 * the run waits on this one.
 *
 * Creating a task with values used to check them through the shared pool
 * while it held the project lock. Twenty at once on a pool of five then held
 * all five connections, four waiting for the lock and the one holding it
 * waiting for a sixth, for ever. The build also compiled the pool twice, so
 * a process held two pools of five.
 */

test.skip(!process.env.CI, "it starts the production build, which only CI has");
test.describe.configure({ mode: "serial" });

const APP = unique("ush-pool");
let server: ChildProcess;
let base: string;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

test.beforeAll(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  server = spawn(process.execPath, [".next/standalone/server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "0.0.0.0",
      DATABASE_POOL_MAX: "5",
      PGAPPNAME: APP,
    },
    stdio: "ignore",
  });
  const until = Date.now() + 30_000;
  for (;;) {
    const up = await fetch(`${base}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) break;
    if (Date.now() > until) throw new Error("The second server did not start.");
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.afterAll(() => {
  server?.kill();
});

async function connections(): Promise<number> {
  return inDatabase(async (c) => {
    const { rows } = await c.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where application_name = $1",
      [APP],
    );
    return rows[0].n;
  });
}

type Board = { properties: { id: string; name: string; options: { id: string }[] }[] };

async function columns(request: APIRequestContext, projectId: string) {
  const res = await request.get(`${base}/api/projects/${projectId}/board`);
  expect(res.status()).toBe(200);
  const { properties } = (await res.json()) as Board;
  const of = (name: string) => properties.find((p) => p.name === name)!;
  return { status: of("Status"), priority: of("Priority") };
}

test("twenty task creates with values at once all finish on a pool of five, in one pool", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await register(page, "Pool Person");
  const projectId = await createProject(page, unique("Pool"));
  const { status, priority } = await columns(page.request, projectId);

  let most = 0;
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      most = Math.max(most, await connections());
      await new Promise((r) => setTimeout(r, 50));
    }
  })();

  /* The pages read through the page chunks' copy of the pool, the creates
     through the routes', so a second pool would show in the count. */
  const creates = Array.from({ length: 20 }, (_, i) =>
    page.request.post(`${base}/api/projects/${projectId}/tasks`, {
      data: {
        title: `Burst ${i}`,
        values: {
          [status.id]: status.options[i % status.options.length].id,
          [priority.id]: priority.options[i % priority.options.length].id,
        },
      },
      timeout: 60_000,
    }),
  );
  const pages = Array.from({ length: 5 }, () =>
    page.request.get(`${base}/p/${projectId}`, { timeout: 60_000 }),
  );
  const answers = await Promise.all(creates);
  const drawn = await Promise.all(pages);
  watching = false;
  await watcher;

  expect(answers.map((a) => a.status())).toEqual(Array(20).fill(201));
  expect(drawn.map((a) => a.status())).toEqual(Array(5).fill(200));
  /* Five for the pool and, at most, one for live updates. */
  expect(most).toBeGreaterThan(0);
  expect(most).toBeLessThanOrEqual(6);

  const count = await inDatabase(async (c) => {
    const { rows } = await c.query<{ n: number }>(
      "select count(*)::int as n from tasks where project_id = $1 and title like 'Burst %'",
      [projectId],
    );
    return rows[0].n;
  });
  expect(count).toBe(20);
});

test("a write that waits too long for the project lock answers 503", async ({ page }) => {
  test.setTimeout(90_000);
  await register(page, "Lock Person");
  const projectId = await createProject(page, unique("Lock"));

  const answer = await inDatabase(async (c) => {
    await c.query("begin");
    await c.query("select 1 from projects where id = $1 for update", [projectId]);
    try {
      return await page.request.post(`${base}/api/projects/${projectId}/tasks`, {
        data: { title: "Waits" },
        timeout: 60_000,
      });
    } finally {
      await c.query("rollback");
    }
  });

  expect(answer.status()).toBe(503);
  expect(await answer.json()).toEqual({ error: "The server is busy. Try again in a moment." });
});
