import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/db");
const { agent, api, ok, person, project, task } = await import("@/test/route");

/*
 * USH-469: the Activity tab of a task reads past its newest sixty lines. The
 * panel's half is in `ActivityFeed.test.tsx`.
 */

type Line = { id: string; kind: string; data: { n?: number } };
type Detail = { task: { activity: Line[]; activityMore: boolean } };

/** Writes `count` lines on a task beside its own "created", oldest first. */
async function lines(projectId: string, taskId: string, actorId: string, sameMoment: boolean) {
  await db.execute(sql`
    insert into activity (project_id, task_id, actor_id, kind, data, created_at)
    select ${projectId}, ${taskId}, ${actorId}, 'comment', jsonb_build_object('n', n),
           case when ${sameMoment} then now() - interval '1 hour'
                else now() - interval '1 hour' + n * interval '1 second' end
      from generate_series(1, 130) as n`);
}

async function readAll(caller: { api: ReturnType<typeof api> }, taskId: string) {
  const first = (await ok(caller.api.get(`/api/tasks/${taskId}`))) as Detail;
  expect(first.task.activity).toHaveLength(60);
  expect(first.task.activityMore).toBe(true);
  const seen = [...first.task.activity];
  let more = first.task.activityMore;
  let pages = 0;
  while (more) {
    const page = (await ok(
      caller.api.get(`/api/tasks/${taskId}/activity?before=${seen.at(-1)!.id}`),
    )) as { activity: Line[]; more: boolean };
    expect(page.activity.length).toBeLessThanOrEqual(60);
    seen.push(...page.activity);
    more = page.more;
    pages += 1;
  }
  return { seen, pages };
}

describe("The older lines of a task", () => {
  it("lines one write made in one moment are neither lost nor shown twice across a page", async () => {
    const owner = await person("Burst Owner");
    const p = await project(owner);
    const t = await task(owner, p.id, "A burst");
    await lines(p.id, t.id, owner.id, true);
    // 130 in one moment and the task's own "created": three pages.
    const { seen, pages } = await readAll({ api: api(owner) }, t.id);
    expect(pages).toBe(2);
    expect(seen).toHaveLength(131);
    expect(new Set(seen.map((l) => l.id)).size).toBe(131);
  });

  it("a task with 61 lines says there are more, and the next page holds the 61st", async () => {
    const owner = await person("Page Owner");
    const p = await project(owner);
    const t = await task(owner, p.id, "Sixty-one");
    // The task's "created" is one line; sixty more make sixty-one.
    await db.execute(sql`
      insert into activity (project_id, task_id, actor_id, kind, data, created_at)
      select ${p.id}, ${t.id}, ${owner.id}, 'comment', jsonb_build_object('n', n),
             now() + n * interval '1 second'
        from generate_series(1, 60) as n`);
    const first = (await ok(api(owner).get(`/api/tasks/${t.id}`))) as Detail;
    expect(first.task.activity).toHaveLength(60);
    expect(first.task.activity[0].data.n).toBe(60);
    expect(first.task.activityMore).toBe(true);
    const page = (await ok(
      api(owner).get(`/api/tasks/${t.id}/activity?before=${first.task.activity.at(-1)!.id}`),
    )) as { activity: Line[]; more: boolean };
    expect(page.activity.map((l) => l.kind)).toEqual(["created"]);
    expect(page.more).toBe(false);
  });

  it("answers a member and an agent, newest first, and 404 for a task of another project", async () => {
    const owner = await person("Route Owner");
    const p = await project(owner);
    const t = await task(owner, p.id, "Read me");
    const bot = await agent(owner, p.id, "Reader");
    await lines(p.id, t.id, bot.id, false);

    const byOwner = await readAll({ api: api(owner) }, t.id);
    const byAgent = await readAll(bot, t.id);
    expect(byAgent.seen.map((l) => l.id)).toEqual(byOwner.seen.map((l) => l.id));
    expect(byOwner.seen).toHaveLength(131);
    // Newest first: "created" is now, and n runs down from an hour ago.
    expect(byOwner.seen[0].kind).toBe("created");
    const ns = byOwner.seen.slice(1).map((l) => l.data.n);
    expect(ns).toEqual(Array.from({ length: 130 }, (_, i) => 130 - i));

    const cursor = byOwner.seen[10].id;
    const stranger = await person("Stranger");
    const theirs = await project(stranger);
    const theirTask = await task(stranger, theirs.id, "Not yours");
    const theirBot = await agent(stranger, theirs.id, "Other bot");
    for (const caller of [api(stranger), theirBot.api]) {
      expect((await caller.get(`/api/tasks/${t.id}/activity?before=${cursor}`)).status).toBe(404);
    }
    // A line of another task is no cursor, and a cursor is a line.
    expect(
      (await api(stranger).get(`/api/tasks/${theirTask.id}/activity?before=${cursor}`)).status,
    ).toBe(404);
    expect((await api(owner).get(`/api/tasks/${t.id}/activity?before=nope`)).status).toBe(400);
    expect((await api(owner).get(`/api/tasks/${t.id}/activity`)).status).toBe(400);
  });
});
