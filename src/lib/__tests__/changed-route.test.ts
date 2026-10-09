import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));
/* The bucket answers for the file; the rows and the clock are the server's. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  headObject: async () => ({ size: PNG.length, mime: "image/png" }),
  readHead: async () => new Uint8Array(PNG),
  removeObject: async () => undefined,
}));

const { db } = await import("@/db");
const { agent, api, board, ok, person, project, task } = await import("@/test/route");

/*
 * A task's changed time says when a person or an agent last did something to
 * it. Each act below winds the clock back first, so a bump is seen however
 * fast the act runs, and a write that must not bump is seen not to.
 *
 * What moves it is the server's write, so these were always route calls:
 * they were the first three tests of `e2e/changed.spec.ts`, and carry its
 * names. The fourth, the line in the panel, is in `Stamps.test.tsx`.
 */
const LONG_AGO = "2020-01-02T03:04:05.000Z";

async function windBack(taskId: string) {
  await db.execute(sql`update tasks set updated_at = ${LONG_AGO} where id = ${taskId}`);
}

async function changedAt(taskId: string): Promise<string> {
  const { rows } = await db.execute<{ updated_at: string }>(
    sql`select to_json(updated_at)#>>'{}' as updated_at from tasks where id = ${taskId}`,
  );
  return new Date(rows[0].updated_at).toISOString();
}

type Act = { what: string; run: () => Promise<Response> };

async function moves(taskId: string, act: Act) {
  await windBack(taskId);
  const answer = await act.run();
  expect(answer.ok, `${act.what} answered ${answer.status}`).toBe(true);
  expect(await changedAt(taskId), `${act.what} moves the changed time`).not.toBe(LONG_AGO);
}

async function leaves(taskId: string, act: Act) {
  await windBack(taskId);
  const answer = await act.run();
  expect(answer.ok, `${act.what} answered ${answer.status}`).toBe(true);
  expect(await changedAt(taskId), `${act.what} leaves the changed time`).toBe(LONG_AGO);
}

type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  tasks: { id: string; updatedAt: string }[];
};

async function statusOf(who: Awaited<ReturnType<typeof person>>, projectId: string) {
  return ((await board(who, projectId)) as Board).properties.find((p) => p.name === "Status")!;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("A task's changed time", () => {
  it("everything a person does to a task moves its changed time", async () => {
    const me = await person("Toucher");
    const p = await project(me);
    const r = api(me);
    const { id } = await task(me, p.id, "Touched all over");
    const { id: other } = await task(me, p.id, "The other one");
    const status = await statusOf(me, p.id);
    const doing = status.options.find((o) => o.name === "In Progress")!;

    await moves(id, {
      what: "a title",
      run: () => r.patch(`/api/tasks/${id}`, { title: "Touched everywhere" }),
    });
    await moves(id, {
      what: "a description",
      run: () => r.patch(`/api/tasks/${id}`, { description: "Words." }),
    });
    await moves(id, {
      what: "a value",
      run: () => r.put(`/api/tasks/${id}/values/${status.id}`, { value: doing.id }),
    });

    let commentId = "";
    await moves(id, {
      what: "a comment",
      run: async () => {
        const answer = await r.post(`/api/tasks/${id}/comments`, { body: "Hello" });
        commentId = (await answer.clone().json()).comment.id;
        return answer;
      },
    });
    await moves(id, {
      what: "an edited comment",
      run: () => r.patch(`/api/comments/${commentId}`, { body: "Hello again" }),
    });
    await moves(id, { what: "a deleted comment", run: () => r.del(`/api/comments/${commentId}`) });

    let itemId = "";
    await moves(id, {
      what: "a checklist item",
      run: async () => {
        const answer = await r.post(`/api/tasks/${id}/checklist`, { text: "One" });
        itemId = (await answer.clone().json()).item.id;
        return answer;
      },
    });
    await moves(id, {
      what: "a checklist tick",
      run: () => r.patch(`/api/checklist/${itemId}`, { done: true }),
    });
    await moves(id, {
      what: "a checklist item taken away",
      run: () => r.del(`/api/checklist/${itemId}`),
    });

    await moves(id, {
      what: "a blocker",
      run: () => r.post(`/api/tasks/${id}/blockers`, { blockerId: other }),
    });
    await moves(id, {
      what: "a blocker taken away",
      run: () => r.del(`/api/tasks/${id}/blockers/${other}`),
    });
    await moves(id, {
      what: "a parent",
      run: () => r.put(`/api/tasks/${id}/parent`, { parentId: other }),
    });
    await moves(id, { what: "a parent taken away", run: () => r.del(`/api/tasks/${id}/parent`) });

    await moves(id, { what: "an archive", run: () => r.post(`/api/tasks/${id}/archive`) });
    await moves(id, { what: "an unarchive", run: () => r.del(`/api/tasks/${id}/archive`) });
    await moves(id, {
      what: "an archive of many",
      run: () => r.post(`/api/projects/${p.id}/archive`, { taskIds: [id] }),
    });
    await ok(r.del(`/api/tasks/${id}/archive`));
    await ok(r.del(`/api/tasks/${id}`));
    await moves(id, { what: "a restore", run: () => r.post(`/api/tasks/${id}/restore`) });

    /* A drag into another column writes a value, so it is a change. */
    const todo = status.options.find((o) => o.name === "Todo")!;
    await moves(id, {
      what: "a move to another column",
      run: () =>
        r.post(`/api/tasks/${id}/move`, { afterId: other, values: { [status.id]: todo.id } }),
    });

    /* The board hands the same moment on, for the panel and the search. */
    const read = (await board(me, p.id)) as Board;
    expect(read.tasks.find((t) => t.id === id)?.updatedAt).toBe(await changedAt(id));
  });

  it("a drag inside a column, a run report, a beat and a deleted option do not", async () => {
    const me = await person("Watcher");
    const p = await project(me);
    const r = api(me);
    const { id } = await task(me, p.id, "Left alone");
    const { id: other } = await task(me, p.id, "Its neighbour");

    await leaves(id, {
      what: "a drag inside one column",
      run: () => r.post(`/api/tasks/${id}/move`, { afterId: other }),
    });

    /* A property somebody reshapes rewrites the value, and that is not a touch. */
    const status = await statusOf(me, p.id);
    const doing = status.options.find((o) => o.name === "In Progress")!;
    await ok(r.put(`/api/tasks/${id}/values/${status.id}`, { value: doing.id }));
    await leaves(id, { what: "a deleted option", run: () => r.del(`/api/options/${doing.id}`) });

    const bot = await agent(me, p.id, "Reporter");
    const { run } = await ok<{ run: { id: string } }>(
      bot.api.post(`/api/tasks/${id}/run`, { goal: "Build it", step: "Starting" }),
    );

    await leaves(id, {
      what: "a run report",
      run: () => bot.api.patch(`/api/runs/${run.id}`, { step: "Halfway" }),
    });
    await leaves(id, {
      what: "a beat",
      run: () => bot.api.patch(`/api/runs/${run.id}`, { beat: true }),
    });

    /* The same agent writing a comment is somebody doing something. */
    await moves(id, {
      what: "an agent's comment",
      run: () => bot.api.post(`/api/tasks/${id}/comments`, { body: "Done." }),
    });
  });

  /* End to end this skipped wherever there was no bucket. The bucket is what
     says the bytes are there, so it is the one thing faked here. */
  it("a file added and taken away moves the changed time", async () => {
    for (const [k, v] of Object.entries({
      S3_ENDPOINT: "http://minio:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "ushabti",
      S3_ACCESS_KEY: "minio",
      S3_SECRET_KEY: "minio-secret",
      S3_FORCE_PATH_STYLE: "1",
    }))
      vi.stubEnv(k, v);
    const me = await person("Filer");
    const p = await project(me);
    const r = api(me);
    const { id } = await task(me, p.id, "Has a file");
    const { id: fileId } = await ok<{ id: string }>(
      r.post(`/api/tasks/${id}/attachments`, {
        name: "dot.png",
        mime: "image/png",
        size: PNG.length,
      }),
    );

    await moves(id, { what: "a file", run: () => r.post(`/api/attachments/${fileId}/ready`) });
    await moves(id, { what: "a file taken away", run: () => r.del(`/api/attachments/${fileId}`) });
  });
});
