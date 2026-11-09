import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, board, ok, person, project, task } = await import("@/test/route");
const { reverseNameOf } = await import("@/lib/related");

/*
 * The other side of a Tasks property: the task a value names lists the tasks
 * that name it, worked out on every read of its detail and stored nowhere.
 * The panel that draws it is `e2e/relation-reverse.spec.ts`.
 */

type Pointed = { propertyId: string; tasks: { id: string; key: string; archived: boolean }[] };
type Prop = { id: string; name: string; config: { reverseName?: string } };

async function setUp(name = "Duplicate of") {
  const me = await person("Reverse Owner");
  const p = await project(me);
  const r = api(me);
  const made = await ok<{ property: { id: string } }>(
    r.post(`/api/projects/${p.id}/properties`, { name, type: "relation" }),
  );
  const prop = made.property.id;
  const put = (taskId: string, value: unknown) =>
    r.put(`/api/tasks/${taskId}/values/${prop}`, { value });
  const pointedBy = async (taskId: string) =>
    (await ok<{ task: { pointedBy: Pointed[] } }>(r.get(`/api/tasks/${taskId}`))).task.pointedBy;
  const property = async () =>
    ((await board(me, p.id)) as { properties: Prop[] }).properties.find((x) => x.id === prop)!;
  return { me, p, r, prop, put, pointedBy, property };
}

describe("The reverse side of a Tasks property", () => {
  it("lists the tasks that point at a task, under the reverse name when one is set", async () => {
    const { me, p, r, prop, put, pointedBy, property } = await setUp();
    const original = await task(me, p.id, "Login breaks on Safari");
    const twin = await task(me, p.id, "Safari login fails");
    const other = await task(me, p.id, "Cannot sign in");
    await ok(put(twin.id, [original.id]));
    await ok(put(other.id, [original.id, twin.id]));

    expect(await pointedBy(original.id)).toEqual([
      {
        propertyId: prop,
        tasks: [
          { id: twin.id, key: twin.key, title: "Safari login fails", archived: false },
          { id: other.id, key: other.key, title: "Cannot sign in", archived: false },
        ],
      },
    ]);
    expect((await pointedBy(twin.id))[0].tasks.map((t) => t.key)).toEqual([other.key]);
    // A task that points and is pointed at by nobody has no other side.
    expect(await pointedBy(other.id)).toEqual([]);

    await ok(r.patch(`/api/properties/${prop}`, { reverseName: "  Duplicated by " }));
    const named = await property();
    expect(named.config.reverseName).toBe("Duplicated by");
    expect(reverseNameOf(named)).toBe("Duplicated by");
    expect(named.name).toBe("Duplicate of");
  });

  it("reads under the property's own name with no reverse name, and an empty one takes it off", async () => {
    const { r, prop, property } = await setUp("Relates to");
    expect(reverseNameOf(await property())).toBe("Relates to");

    await ok(r.patch(`/api/properties/${prop}`, { reverseName: "Related to" }));
    expect(reverseNameOf(await property())).toBe("Related to");
    await ok(r.patch(`/api/properties/${prop}`, { reverseName: "" }));
    const cleared = await property();
    expect(cleared.config.reverseName).toBeUndefined();
    expect(reverseNameOf(cleared)).toBe("Relates to");

    const long = await r.patch(`/api/properties/${prop}`, { reverseName: "x".repeat(41) });
    expect(long.status).toBe(400);
  });

  it("lists an archived pointing task as archived, and leaves a deleted one out", async () => {
    const { me, p, r, put, pointedBy } = await setUp();
    const original = await task(me, p.id, "The original");
    const old = await task(me, p.id, "The old report");
    const gone = await task(me, p.id, "A mistake");
    await ok(put(old.id, [original.id]));
    await ok(put(gone.id, [original.id]));
    await ok(r.post(`/api/tasks/${old.id}/archive`));
    await ok(r.del(`/api/tasks/${gone.id}`));

    const [side] = await pointedBy(original.id);
    expect(side.tasks).toEqual([
      { id: old.id, key: old.key, title: "The old report", archived: true },
    ]);
    await ok(r.post(`/api/tasks/${gone.id}/restore`));
    expect((await pointedBy(original.id))[0].tasks.map((t) => t.key)).toEqual([old.key, gone.key]);
  });

  it("takes this task off the other task's value, and keeps the rest of it", async () => {
    const { me, p, r, prop, put, pointedBy } = await setUp();
    const original = await task(me, p.id, "The original");
    const pointer = await task(me, p.id, "Points at two");
    const second = await task(me, p.id, "Also named");
    const gone = await task(me, p.id, "Named, then deleted");
    await ok(put(pointer.id, [original.id, second.id, gone.id]));
    await ok(r.del(`/api/tasks/${gone.id}`));

    await ok(r.del(`/api/tasks/${pointer.id}/values/${prop}/${original.id}`));
    expect(await pointedBy(original.id)).toEqual([]);
    const read = (await board(me, p.id)) as {
      tasks: { id: string; values: Record<string, unknown> }[];
    };
    // The deleted task stays named, so a restore brings it back.
    expect(read.tasks.find((t) => t.id === pointer.id)?.values[prop]).toEqual([second.id, gone.id]);

    // Already off is what was asked for.
    const again = await ok<{ changed: boolean }>(
      r.del(`/api/tasks/${pointer.id}/values/${prop}/${original.id}`),
    );
    expect(again.changed).toBe(false);
  });

  it("refuses a property that holds no tasks", async () => {
    const { me, p, r } = await setUp();
    const made = await ok<{ property: { id: string } }>(
      r.post(`/api/projects/${p.id}/properties`, { name: "Notes", type: "text" }),
    );
    const t = await task(me, p.id, "A task");
    const res = await r.del(`/api/tasks/${t.id}/values/${made.property.id}/${t.id}`);
    expect(res.status).toBe(400);
    const named = await r.patch(`/api/properties/${made.property.id}`, { reverseName: "Back" });
    expect(named.status).toBe(400);
  });

  it("asks what renaming asks: an agent with Change structure off cannot set it", async () => {
    const { me, p, prop } = await setUp();
    const bot = await agent(me, p.id);
    await ok(bot.api.patch(`/api/properties/${prop}`, { reverseName: "Duplicated by" }));
    await ok(
      api(me).patch(`/api/projects/${p.id}/agents/${bot.id}`, { acts: { structure: false } }),
    );
    const refused = await bot.api.patch(`/api/properties/${prop}`, { reverseName: "Twins" });
    expect(refused.status).toBe(403);
    const renamed = await bot.api.patch(`/api/properties/${prop}`, { name: "Twins" });
    expect(renamed.status).toBe(403);
  });
});
