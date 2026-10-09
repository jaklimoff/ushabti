import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/db");
const { listSources, tasks } = await import("@/db/schema");
const { agent, api, board, join, ok, person, project, task } = await import("@/test/route");

/*
 * What the list routes keep, read and refuse. A list is one person's, so
 * another person's id answers 404 and an agent's token is refused.
 */

type Option = { id: string; name: string };
type Property = { id: string; name: string; options: Option[] };
type Group = {
  projectId: string;
  key: string;
  count: number;
  rules: string[];
  rows: { id: string; key: string; chip: { text: string } | null }[];
};

async function shape(who: Parameters<typeof board>[0], projectId: string) {
  const b = await board(who, projectId);
  const property = (name: string) => (b.properties as Property[]).find((p) => p.name === name)!;
  const option = (prop: string, name: string) =>
    property(prop).options.find((o) => o.name === name)!.id;
  return { property, option };
}

async function newList(who: Parameters<typeof api>[0]) {
  const { list } = await ok<{ list: { id: string; name: string } }>(api(who).post("/api/lists"));
  return list;
}

async function addSource(who: Parameters<typeof api>[0], listId: string, projectId: string) {
  const { source } = await ok<{ source: { id: string } }>(
    api(who).post(`/api/lists/${listId}/sources`, { projectId }),
  );
  return source;
}

async function groupsOf(who: Parameters<typeof api>[0], listId: string): Promise<Group[]> {
  return (await ok<{ groups: Group[] }>(api(who).get(`/api/lists/${listId}`))).groups;
}

const keysIn = (groups: Group[]) => groups.flatMap((g) => g.rows.map((r) => r.key)).sort();

describe("A list", () => {
  it("is named New list, and its name changes", async () => {
    const me = await person("List Maker");
    const list = await newList(me);
    expect(list.name).toBe("New list");
    await ok(api(me).patch(`/api/lists/${list.id}`, { name: "Mine to do" }));
    const { lists } = await ok<{ lists: { name: string }[] }>(api(me).get("/api/lists"));
    expect(lists.map((l) => l.name)).toEqual(["Mine to do"]);
  });

  it("holds the tasks that pass any one source, and no archived task", async () => {
    const me = await person("Two Boards");
    const one = await project(me);
    const two = await project(me);
    const a = await task(me, one.id, "Urgent in one");
    const b = await task(me, one.id, "Quiet in one");
    const c = await task(me, two.id, "Anything in two");
    const d = await task(me, two.id, "Archived in two");
    await ok(api(me).post(`/api/tasks/${d.id}/archive`));

    const { property, option } = await shape(me, one.id);
    await ok(
      api(me).put(`/api/tasks/${a.id}/values/${property("Priority").id}`, {
        value: option("Priority", "Urgent"),
      }),
    );

    const list = await newList(me);
    const first = await addSource(me, list.id, one.id);
    await addSource(me, list.id, two.id);
    await ok(
      api(me).patch(`/api/lists/${list.id}/sources/${first.id}`, {
        filters: {
          rules: [
            {
              propertyId: property("Priority").id,
              op: "is",
              values: [option("Priority", "Urgent")],
            },
          ],
        },
      }),
    );

    const groups = await groupsOf(me, list.id);
    expect(keysIn(groups)).toEqual([a.key, c.key].sort());
    expect(keysIn(groups)).not.toContain(b.key);
    expect(keysIn(groups)).not.toContain(d.key);
    // Grouped in project order, each with its rules in words.
    expect(groups.map((g) => g.projectId)).toEqual([one.id, two.id]);
    expect(groups[0].rules).toEqual(["Priority is Urgent"]);
    expect(groups[1].rules).toEqual(["Every task"]);
    expect(groups[0].rows[0].chip?.text).toBe("Urgent");
  });

  it("drops a rule about a deleted property or option, and the source still lists", async () => {
    const me = await person("Deleter");
    const p = await project(me);
    const t = await task(me, p.id, "Still here");
    const { property, option } = await shape(me, p.id);
    const list = await newList(me);
    const source = await addSource(me, list.id, p.id);
    const priority = property("Priority");
    await ok(
      api(me).patch(`/api/lists/${list.id}/sources/${source.id}`, {
        filters: {
          rules: [{ propertyId: priority.id, op: "is", values: [option("Priority", "Urgent")] }],
        },
      }),
    );
    expect(keysIn(await groupsOf(me, list.id))).toEqual([]);

    await ok(api(me).del(`/api/properties/${priority.id}`));

    // The row still holds the rule; the read throws it away.
    const [row] = await db.select().from(listSources).where(eq(listSources.id, source.id));
    expect((row.filters as { rules: unknown[] }).rules).toHaveLength(1);
    const groups = await groupsOf(me, list.id);
    expect(keysIn(groups)).toEqual([t.key]);
    expect(groups[0].rules).toEqual(["Every task"]);
  });

  it("drops the deleted option from a rule on the write", async () => {
    const me = await person("Option Gone");
    const p = await project(me);
    const { property } = await shape(me, p.id);
    const list = await newList(me);
    const source = await addSource(me, list.id, p.id);
    const { source: kept } = await ok<{ source: { filters: { rules: unknown[] } } }>(
      api(me).patch(`/api/lists/${list.id}/sources/${source.id}`, {
        filters: { rules: [{ propertyId: property("Priority").id, op: "is", values: ["gone"] }] },
      }),
    );
    expect(kept.filters.rules).toEqual([]);
  });

  it("brings nothing from a project the person left, and brings it back on rejoining", async () => {
    const owner = await person("Board Owner");
    const me = await person("Leaver");
    const p = await project(owner);
    await join(p.id, me, "member");
    const t = await task(owner, p.id, "Shared work");
    const list = await newList(me);
    await addSource(me, list.id, p.id);
    expect(keysIn(await groupsOf(me, list.id))).toEqual([t.key]);

    await ok(api(owner).del(`/api/projects/${p.id}/members/${me.id}`));
    expect(await groupsOf(me, list.id)).toEqual([]);
    // Nothing deleted the source.
    expect(await db.select().from(listSources).where(eq(listSources.listId, list.id))).toHaveLength(
      1,
    );

    await join(p.id, me, "member");
    expect(keysIn(await groupsOf(me, list.id))).toEqual([t.key]);
  });

  it("is deleted without deleting a task", async () => {
    const me = await person("Tidy");
    const p = await project(me);
    const t = await task(me, p.id, "Outlives the list");
    const list = await newList(me);
    await addSource(me, list.id, p.id);
    await ok(api(me).del(`/api/lists/${list.id}`));
    expect((await api(me).get(`/api/lists/${list.id}`)).status).toBe(404);
    expect(await db.select().from(tasks).where(eq(tasks.id, t.id))).toHaveLength(1);
  });

  it("answers 404 to another person, and refuses an agent", async () => {
    const me = await person("Owner Of List");
    const other = await person("Somebody Else");
    const p = await project(me);
    const list = await newList(me);
    const source = await addSource(me, list.id, p.id);

    for (const res of [
      await api(other).get(`/api/lists/${list.id}`),
      await api(other).patch(`/api/lists/${list.id}`, { name: "Taken" }),
      await api(other).del(`/api/lists/${list.id}`),
      await api(other).post(`/api/lists/${list.id}/sources`, { projectId: p.id }),
      await api(other).patch(`/api/lists/${list.id}/sources/${source.id}`, { filters: {} }),
      await api(other).del(`/api/lists/${list.id}/sources/${source.id}`),
    ]) {
      expect(res.status).toBe(404);
    }

    const bot = await agent(me, p.id);
    for (const res of [
      await bot.api.get("/api/lists"),
      await bot.api.post("/api/lists"),
      await bot.api.get(`/api/lists/${list.id}`),
      await bot.api.patch(`/api/lists/${list.id}`, { name: "Bot" }),
      await bot.api.del(`/api/lists/${list.id}`),
    ]) {
      expect(res.status).toBe(403);
    }
  });

  it("takes a source only from a project the person is on", async () => {
    const me = await person("Outsider");
    const stranger = await person("Stranger");
    const theirs = await project(stranger);
    const list = await newList(me);
    const res = await api(me).post(`/api/lists/${list.id}/sources`, { projectId: theirs.id });
    expect(res.status).toBe(404);
  });
});
