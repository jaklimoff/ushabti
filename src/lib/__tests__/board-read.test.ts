import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, backdateRun, board, ok, person, project, task } = await import("@/test/route");

/*
 * What a board read works out for itself, held to what it answered before it
 * stopped sorting the whole run history and counting a task at a time.
 */

type Read = {
  tasks: { id: string; checklistTotal: number; checklistDone: number; commentCount: number }[];
  properties: { id: string; name: string; type: string; options: { id: string }[] }[];
  stopped: { taskId: string }[];
};

async function claim(bot: Awaited<ReturnType<typeof agent>>, taskId: string) {
  return (await ok(bot.api.post(`/api/tasks/${taskId}/run`, { goal: "Work" }))).run as {
    id: string;
  };
}

describe("A board read", () => {
  it("names a task whose newest run the lease closed, and no other", async () => {
    const owner = await person("Read Owner");
    const p = await project(owner);
    const quiet = await task(owner, p.id, "Quiet");
    const again = await task(owner, p.id, "Again");
    const seen = await task(owner, p.id, "Seen");
    const bot = await agent(owner, p.id);

    for (const t of [quiet, again, seen]) await backdateRun((await claim(bot, t.id)).id, 60);
    // The first read sweeps all three closed.
    const swept = (await board(owner, p.id)) as Read;
    expect(swept.stopped.map((s) => s.taskId).sort()).toEqual([again.id, quiet.id, seen.id].sort());

    // A new run is somebody on the task again; an older lost run is no reason.
    await claim(bot, again.id);
    // A person who wrote a value has seen the task.
    const status = swept.properties.find((x) => x.name === "Status")!;
    await ok(
      api(owner).put(`/api/tasks/${seen.id}/values/${status.id}`, { value: status.options[1].id }),
    );

    const read = (await board(owner, p.id)) as Read;
    expect(read.stopped.map((s) => s.taskId)).toEqual([quiet.id]);
  });

  it("counts each task's checklist and comments, and nothing of another task", async () => {
    const owner = await person("Count Owner");
    const p = await project(owner);
    const busy = await task(owner, p.id, "Busy");
    const bare = await task(owner, p.id, "Bare");
    const me = api(owner);

    const items = [];
    for (const text of ["One", "Two", "Three"])
      items.push((await ok(me.post(`/api/tasks/${busy.id}/checklist`, { text }))).item);
    await ok(me.patch(`/api/checklist/${items[1].id}`, { done: true }));
    for (const body of ["First", "Second"])
      await ok(me.post(`/api/tasks/${busy.id}/comments`, { body }));

    const read = (await board(owner, p.id)) as Read;
    const counts = (id: string) => {
      const t = read.tasks.find((x) => x.id === id)!;
      return [t.checklistTotal, t.checklistDone, t.commentCount];
    };
    expect(counts(busy.id)).toEqual([3, 1, 2]);
    expect(counts(bare.id)).toEqual([0, 0, 0]);
  });
});
