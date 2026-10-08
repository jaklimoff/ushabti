import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, board, ok, person, project, task } = await import("@/test/route");

/*
 * The feed an agent reads after its cursor. Each test was a test of
 * `e2e/listening.spec.ts` and carries its name. The watcher that reads this
 * feed stayed there, because it needs the stream.
 */

describe("A line that says whom it is for", () => {
  /* A watcher decides from the line, so the line has to say it. The panel
     reads the same line and names the person; that half is in
     `AgentTab.test.tsx`. */
  it("a value line names its type and its person, and the panel names the person", async () => {
    const owner = await person("Line Owner");
    const p = await project(owner);
    const t = await task(owner, p.id, "Hand it over");
    const reis = await agent(owner, p.id, "Reis");
    const data = await board(owner, p.id);
    const assignee = data.properties.find((x: { type: string }) => x.type === "person");
    const status = data.properties.find((x: { type: string }) => x.type === "select");
    const since = (await ok(reis.api.get(`/api/projects/${p.id}/activity`))).now;

    const put = (propertyId: string, value: unknown) =>
      ok(api(owner).put(`/api/tasks/${t.id}/values/${propertyId}`, { value }));
    await put(assignee.id, reis.id);
    await put(status.id, status.options[1].id);
    await ok(
      api(owner).post(`/api/projects/${p.id}/tasks`, {
        title: "Made for Reis",
        values: { [assignee.id]: reis.id },
      }),
    );

    type Line = { kind: string; taskKey: string; data: Record<string, unknown> };
    const { entries } = (await ok(
      reis.api.get(`/api/projects/${p.id}/activity?after=${encodeURIComponent(since)}`),
    )) as { entries: Line[] };
    const values = entries.filter((e) => e.kind === "value" && e.taskKey === t.key);
    expect(values.find((e) => e.data.propertyId === assignee.id)?.data).toMatchObject({
      type: "person",
      personId: reis.id,
    });
    const drag = values.find((e) => e.data.propertyId === status.id)?.data;
    expect(drag).toMatchObject({ type: "select" });
    expect(drag).not.toHaveProperty("personId");
    expect(entries.find((e) => e.kind === "created")?.data.assigneeIds).toEqual([reis.id]);
  });
});

describe("A write of more than a page of lines", () => {
  /* One write stamps all its lines with one moment. A feed paged by the
     moment alone read the first 200 of such a burst for ever. */
  it("a feed of 500 lines written at one moment is read whole, 200 at a time", async () => {
    const owner = await person("Feed Owner");
    const p = await project(owner);
    const select = (await board(owner, p.id)).properties.find(
      (x: { type: string }) => x.type === "select",
    );
    const keep = await task(owner, p.id, "Keep me");
    await ok(
      api(owner).put(`/api/tasks/${keep.id}/values/${select.id}`, { value: select.options[0].id }),
    );
    for (let made = 0; made < 500; made += 1) await task(owner, p.id, `Burst ${made}`);

    const since = (await ok(api(owner).get(`/api/projects/${p.id}/activity`))).now;
    const archived = await ok(
      api(owner).post(`/api/projects/${p.id}/archive`, { propertyId: select.id, value: null }),
    );
    expect(archived.archived).toBe(500);

    type FeedEntry = { id: string; kind: string; createdAt: string };
    const read: FeedEntry[] = [];
    const pages: number[] = [];
    let query = `after=${encodeURIComponent(since)}`;
    for (;;) {
      const { entries } = (await ok(
        api(owner).get(`/api/projects/${p.id}/activity?${query}&limit=200`),
      )) as { entries: FeedEntry[] };
      pages.push(entries.length);
      read.push(...entries);
      if (entries.length < 200 || pages.length > 5) break;
      const last = entries[entries.length - 1];
      query = `after=${encodeURIComponent(last.createdAt)}&afterId=${last.id}`;
    }

    expect(pages).toEqual([200, 200, 100]);
    expect(new Set(read.map((e) => e.id)).size).toBe(500);
    expect(read.every((e) => e.kind === "archive")).toBe(true);
    // One write, one moment: the moment alone could not have said where a page ended.
    expect(new Set(read.map((e) => e.createdAt)).size).toBe(1);

    const bad = await api(owner).get(
      `/api/projects/${p.id}/activity?after=${encodeURIComponent(since)}&afterId=nope`,
    );
    expect(bad.status).toBe(400);
  });
});
