import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project, task } = await import("@/test/route");
const { tasksOf } = await import("@/lib/related");

/*
 * A property of type Tasks, as the server keeps it: a list of task ids in
 * `task_values`, guarded on the write and read afresh on the draw. The field
 * that picks them is `e2e/relation.spec.ts`.
 */

type Board = {
  properties: { id: string; name: string; type: string }[];
  tasks: { id: string; key: string; title: string; values: Record<string, unknown> }[];
  archived: { id: string; key: string; title: string }[];
};

async function setUp() {
  const me = await person("Relation Owner");
  const p = await project(me);
  const r = api(me);
  const made = await ok<{ property: { id: string } }>(
    r.post(`/api/projects/${p.id}/properties`, { name: "Duplicate of", type: "relation" }),
  );
  const prop = made.property.id;
  const put = (taskId: string, value: unknown) =>
    r.put(`/api/tasks/${taskId}/values/${prop}`, { value });
  return { me, p, r, prop, put };
}

describe("A Tasks property", () => {
  it("can be added, and keeps each picked task once", async () => {
    const { me, p, prop, put } = await setUp();
    const a = await task(me, p.id, "Login breaks on Safari");
    const b = await task(me, p.id, "Safari login fails");
    const c = await task(me, p.id, "Cannot sign in");

    const read = (await board(me, p.id)) as Board;
    expect(read.properties.find((x) => x.id === prop)?.type).toBe("relation");

    await ok(put(a.id, [b.id, c.id, b.id]));
    const after = (await board(me, p.id)) as Board;
    expect(after.tasks.find((t) => t.id === a.id)?.values[prop]).toEqual([b.id, c.id]);
  });

  it("refuses the task itself, a deleted task and a task of another project, with 400", async () => {
    const { me, p, r, put } = await setUp();
    const a = await task(me, p.id, "Here");
    const gone = await task(me, p.id, "Gone");
    await ok(r.del(`/api/tasks/${gone.id}`));
    const elsewhere = await project(me);
    const far = await task(me, elsewhere.id, "Far away");

    const self = await put(a.id, [a.id]);
    expect(self.status).toBe(400);
    expect((await self.json()).error).toBe("A task cannot point at itself.");

    const deleted = await put(a.id, [gone.id]);
    expect(deleted.status).toBe(400);
    expect((await deleted.json()).error).toBe("That task was deleted.");

    const other = await put(a.id, [far.id]);
    expect(other.status).toBe(400);
    expect((await other.json()).error).toBe("That task is not in this project.");

    const nonsense = await put(a.id, ["not-an-id"]);
    expect(nonsense.status).toBe(400);
    const notAList = await put(a.id, far.id);
    expect(notAList.status).toBe(400);
  });

  it("names an archived task, and the line names the keys and carries the ids", async () => {
    const { me, p, r, prop, put } = await setUp();
    const a = await task(me, p.id, "New");
    const old = await task(me, p.id, "Old");
    await ok(r.post(`/api/tasks/${old.id}/archive`));
    const since = (await ok<{ now: string }>(r.get(`/api/projects/${p.id}/activity`))).now;

    await ok(put(a.id, [old.id]));

    const read = (await board(me, p.id)) as Board;
    const value = read.tasks.find((t) => t.id === a.id)!.values[prop] as string[];
    expect(tasksOf(value, read.tasks, read.archived)).toEqual([
      { id: old.id, key: old.key, title: "Old", archived: true },
    ]);

    type Line = { kind: string; taskKey: string; data: Record<string, unknown> };
    const { entries } = await ok<{ entries: Line[] }>(
      r.get(`/api/projects/${p.id}/activity?after=${encodeURIComponent(since)}`),
    );
    const line = entries.find((e) => e.kind === "value" && e.taskKey === a.key);
    expect(line?.data).toMatchObject({
      property: "Duplicate of",
      propertyId: prop,
      type: "relation",
      value: old.key,
      taskIds: [old.id],
    });
  });

  it("drops a deleted task from what is drawn, and brings it back when restored", async () => {
    const { me, p, r, prop, put } = await setUp();
    const a = await task(me, p.id, "Keeps the link");
    const b = await task(me, p.id, "Is deleted");
    await ok(put(a.id, [b.id]));

    const drawn = async () => {
      const read = (await board(me, p.id)) as Board;
      const value = read.tasks.find((t) => t.id === a.id)!.values[prop];
      return {
        value,
        keys: tasksOf(value as string[], read.tasks, read.archived).map((t) => t.key),
      };
    };

    expect(await drawn()).toEqual({ value: [b.id], keys: [b.key] });
    await ok(r.del(`/api/tasks/${b.id}`));
    /* Nothing rewrote the value: the reader drops what it cannot find. */
    expect(await drawn()).toEqual({ value: [b.id], keys: [] });
    await ok(r.post(`/api/tasks/${b.id}/restore`));
    expect(await drawn()).toEqual({ value: [b.id], keys: [b.key] });
  });

  it("goes out in the export as ids, as a person does", async () => {
    const { me, p, r, prop, put } = await setUp();
    const a = await task(me, p.id, "Points");
    const b = await task(me, p.id, "Is pointed at");
    await ok(put(a.id, [b.id]));
    const res = await r.get(`/api/projects/${p.id}/export`);
    const text = await res.text();
    expect(res.status).toBe(200);
    const file = JSON.parse(text) as { tasks: { id: string; values: Record<string, unknown> }[] };
    expect(file.tasks.find((t) => t.id === a.id)?.values[prop]).toEqual([b.id]);
  });
});
