import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project, task } = await import("@/test/route");

/*
 * A line of the feed says what a title or a value was before the write
 * (USH-468). Every route that writes a value line is here; a ship is in
 * `release-route.test.ts`, beside the rest of a ship.
 */

type Line = { kind: string; data: Record<string, unknown> };
type Prop = { id: string; name: string; options: { id: string; name: string }[] };

async function setUp() {
  const owner = await person("Jack");
  const p = await project(owner);
  const me = api(owner);
  const read = (await board(owner, p.id)) as { properties: Prop[] };
  const prop = (name: string) => read.properties.find((x) => x.name === name)!;
  const opt = (name: string, option: string) =>
    prop(name).options.find((o) => o.name === option)!.id;
  const lines = async (taskId: string) =>
    (await ok<{ task: { activity: Line[] } }>(me.get(`/api/tasks/${taskId}`))).task.activity;
  return { owner, p, me, prop, opt, lines };
}

/* The newest line of a kind: the panel's read is newest first. */
const newest = (lines: Line[], kind = "value") => lines.find((l) => l.kind === kind)?.data;

describe("A title line", () => {
  it("keeps the old title as from", async () => {
    const { p, me, owner, lines } = await setUp();
    const t = await task(owner, p.id, "queue thing");
    await ok(me.patch(`/api/tasks/${t.id}`, { title: "Retries stop after five tries" }));
    expect(newest(await lines(t.id), "title")).toEqual({
      title: "Retries stop after five tries",
      from: "queue thing",
    });
  });

  it("keeps no from when the title stays as it was", async () => {
    const { p, me, owner, lines } = await setUp();
    const t = await task(owner, p.id, "Same");
    await ok(me.patch(`/api/tasks/${t.id}`, { title: "Same" }));
    expect(newest(await lines(t.id), "title")).toEqual({ title: "Same" });
  });

  it("still refuses a stale base and writes nothing", async () => {
    const { p, me, owner, lines } = await setUp();
    const t = await task(owner, p.id, "First");
    await ok(me.patch(`/api/tasks/${t.id}`, { title: "Second" }));
    const res = await me.patch(`/api/tasks/${t.id}`, { title: "Third", baseTitle: "First" });
    expect(res.status).toBe(409);
    expect((await res.json()).current).toBe("Second");
    expect((await lines(t.id)).filter((l) => l.kind === "title")).toHaveLength(1);
  });
});

describe("A value line", () => {
  it("keeps the old value as from, and empty when there was none", async () => {
    const { p, me, owner, prop, opt, lines } = await setUp();
    const t = await task(owner, p.id, "Estimate me");
    const estimate = prop("Estimate");
    await ok(me.put(`/api/tasks/${t.id}/values/${estimate.id}`, { value: opt("Estimate", "S") }));
    expect(newest(await lines(t.id))).toMatchObject({ value: "S", from: "empty" });
    await ok(me.put(`/api/tasks/${t.id}/values/${estimate.id}`, { value: null }));
    expect(newest(await lines(t.id))).toMatchObject({ value: "empty", from: "S", optionId: null });
  });

  it("keeps no from when the value stays as it was", async () => {
    const { p, me, owner, prop, opt, lines } = await setUp();
    const t = await task(owner, p.id, "Twice");
    const estimate = prop("Estimate");
    await ok(me.put(`/api/tasks/${t.id}/values/${estimate.id}`, { value: opt("Estimate", "M") }));
    await ok(me.put(`/api/tasks/${t.id}/values/${estimate.id}`, { value: opt("Estimate", "M") }));
    expect(newest(await lines(t.id))).not.toHaveProperty("from");
  });

  it("keeps the old person's id as fromPersonId", async () => {
    const { p, me, owner, prop, lines } = await setUp();
    const t = await task(owner, p.id, "Mine");
    const assignee = prop("Assignee");
    await ok(me.put(`/api/tasks/${t.id}/values/${assignee.id}`, { value: owner.id }));
    await ok(me.put(`/api/tasks/${t.id}/values/${assignee.id}`, { value: null }));
    expect(newest(await lines(t.id))).toMatchObject({
      personId: null,
      fromPersonId: owner.id,
      value: "empty",
    });
  });

  it("says what a multi-select added and took away, in words", async () => {
    const { p, me, owner, prop, opt, lines } = await setUp();
    const t = await task(owner, p.id, "Labelled");
    const labels = prop("Labels");
    const [bug, ux, docs] = ["bug", "ux", "docs"].map((n) => opt("Labels", n));
    await ok(me.put(`/api/tasks/${t.id}/values/${labels.id}`, { value: [ux, docs] }));
    await ok(me.put(`/api/tasks/${t.id}/values/${labels.id}`, { value: [docs, bug] }));
    expect(newest(await lines(t.id))).toMatchObject({
      value: "docs, bug",
      from: "ux, docs",
      added: ["bug"],
      removed: ["ux"],
      optionIds: [docs, bug],
    });
  });

  it("a checkbox nobody ticked was off", async () => {
    const { p, me, owner, lines } = await setUp();
    const made = await ok<{ property: { id: string } }>(
      me.post(`/api/projects/${p.id}/properties`, { name: "Blocked", type: "checkbox" }),
    );
    const t = await task(owner, p.id, "Ticked");
    await ok(me.put(`/api/tasks/${t.id}/values/${made.property.id}`, { value: true }));
    expect(newest(await lines(t.id))).toMatchObject({ value: "on", from: "off" });
  });

  it("a card dropped in another column keeps its old column", async () => {
    const { p, me, owner, prop, opt, lines } = await setUp();
    const t = await task(owner, p.id, "Dragged");
    const status = prop("Status");
    await ok(me.put(`/api/tasks/${t.id}/values/${status.id}`, { value: opt("Status", "Todo") }));
    await ok(
      me.post(`/api/tasks/${t.id}/move`, {
        values: { [status.id]: opt("Status", "In Progress") },
      }),
    );
    expect(newest(await lines(t.id))).toMatchObject({ value: "In Progress", from: "Todo" });
  });

  it("a write to many tasks gives each task its own old value", async () => {
    const { p, me, owner, prop, opt, lines } = await setUp();
    const priority = prop("Priority");
    const [a, b, c] = [
      await task(owner, p.id, "Was high"),
      await task(owner, p.id, "Was low"),
      await task(owner, p.id, "Was nothing"),
    ];
    await ok(
      me.put(`/api/tasks/${a.id}/values/${priority.id}`, { value: opt("Priority", "High") }),
    );
    await ok(me.put(`/api/tasks/${b.id}/values/${priority.id}`, { value: opt("Priority", "Low") }));
    await ok(
      me.post(`/api/projects/${p.id}/tasks/values`, {
        taskIds: [a.id, b.id, c.id],
        propertyId: priority.id,
        value: opt("Priority", "Urgent"),
      }),
    );
    expect(newest(await lines(a.id))).toMatchObject({ value: "Urgent", from: "High" });
    expect(newest(await lines(b.id))).toMatchObject({ value: "Urgent", from: "Low" });
    expect(newest(await lines(c.id))).toMatchObject({ value: "Urgent", from: "empty" });
  });

  it("a change to many multi-selects says what each one gained", async () => {
    const { p, me, owner, prop, opt, lines } = await setUp();
    const labels = prop("Labels");
    const a = await task(owner, p.id, "Had ux");
    await ok(me.put(`/api/tasks/${a.id}/values/${labels.id}`, { value: [opt("Labels", "ux")] }));
    const b = await task(owner, p.id, "Had nothing");
    await ok(
      me.post(`/api/projects/${p.id}/tasks/values`, {
        taskIds: [a.id, b.id],
        propertyId: labels.id,
        value: opt("Labels", "bug"),
        change: "add",
      }),
    );
    expect(newest(await lines(a.id))).toMatchObject({ from: "ux", added: ["bug"], removed: [] });
    expect(newest(await lines(b.id))).toMatchObject({ from: "empty", added: ["bug"] });
  });

  it("a pointed task taken off says which one went", async () => {
    const { p, me, owner, lines } = await setUp();
    const made = await ok<{ property: { id: string } }>(
      me.post(`/api/projects/${p.id}/properties`, { name: "Blocks", type: "relation" }),
    );
    const a = await task(owner, p.id, "Points");
    const b = await task(owner, p.id, "Pointed at");
    const c = await task(owner, p.id, "Also pointed at");
    await ok(me.put(`/api/tasks/${a.id}/values/${made.property.id}`, { value: [b.id, c.id] }));
    await ok(me.del(`/api/tasks/${a.id}/values/${made.property.id}/${b.id}`));
    expect(newest(await lines(a.id))).toMatchObject({
      value: c.key,
      from: `${b.key}, ${c.key}`,
      added: [],
      removed: [b.key],
      taskIds: [c.id],
    });
  });
});
