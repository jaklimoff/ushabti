import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project, task } = await import("@/test/route");

/*
 * What Settings reads: the board's shape, a few tasks for the card view's
 * preview and a count of the rest. Each test was a test of
 * `e2e/settings-load.spec.ts`, and carries its name. That the preview draws
 * those tasks is `CardViewPanel.test.tsx`; a change by somebody else reaching
 * Settings stayed end to end, because it needs the stream.
 */

type Card = { id: string; title: string; parts: unknown; blockedBy: string[] };
type Answer = {
  tasks: Card[];
  properties: { id: string; name: string; options: { id: string }[] }[];
  taskCount?: number;
};

/** Eight tasks, and one that carries more than the rest. */
async function eightTasks() {
  const owner = await person("Load");
  const p = await project(owner);
  const as = api(owner);
  const read = (await board(owner, p.id)) as Answer;
  const priority = read.properties.find((x) => x.name === "Priority")!;
  for (let i = 0; i < 7; i++) await task(owner, p.id, `Light ${i}`);
  const { task: heavy } = await ok<{ task: { id: string } }>(
    as.post(`/api/projects/${p.id}/tasks`, {
      title: "Heavy",
      values: { [priority.id]: priority.options[0].id },
    }),
  );
  return { owner, p, as, heavy };
}

describe("Settings reads its own loader", () => {
  it("opening Settings reads no task", async () => {
    const { as, p } = await eightTasks();
    const answer = await ok<Answer>(as.get(`/api/projects/${p.id}/settings`));
    // The few the preview draws, and a count of the rest.
    expect(answer.tasks.length).toBeLessThanOrEqual(4);
    expect(answer.taskCount).toBe(8);
  });

  it("a previewed task counts its parts and its blockers as the board does", async () => {
    const { owner, p, as, heavy } = await eightTasks();
    const parent = (await task(owner, p.id, "Parent")).id;
    const done = (await task(owner, p.id, "Part done")).id;
    const open = (await task(owner, p.id, "Part open")).id;
    await ok(as.put(`/api/tasks/${open}/parent`, { parentId: parent }));
    await ok(as.put(`/api/tasks/${done}/parent`, { parentId: parent }));
    await ok(as.post(`/api/tasks/${done}/archive`));
    await ok(as.post(`/api/tasks/${heavy.id}/blockers`, { blockerId: parent }));

    const settings = await ok<Answer>(as.get(`/api/projects/${p.id}/settings`));
    const whole = (await board(owner, p.id)) as Answer;
    const ids = settings.tasks.map((t) => t.id);
    expect(ids).toContain(heavy.id);
    expect(ids).toContain(parent);
    for (const card of settings.tasks) {
      expect(card).toEqual(whole.tasks.find((t) => t.id === card.id));
    }
    expect(settings.tasks.find((t) => t.id === parent)!.parts).toEqual({ done: 1, total: 2 });
    expect(settings.tasks.find((t) => t.id === heavy.id)!.blockedBy).toHaveLength(1);
  });
});
