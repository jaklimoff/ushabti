import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/test/db");
const { tasks } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { api, ok, person, project, task } = await import("@/test/route");

/*
 * A board read carries the archived list only when the caller does not hold
 * it already. The caller says what it holds by the stamp the last answer
 * carried. The browser's half, which reads a missing list as the one it kept,
 * is in `ArchivedStamp.test.tsx`.
 */

type Answer = {
  archived?: { id: string; key: string; title: string; position: string }[];
  archivedStamp: string;
  tasks: { id: string; parts: { done: number; total: number } | null }[];
};

async function setUp() {
  const me = await person();
  const p = await project(me);
  const r = api(me);
  const read = (stamp?: string) =>
    ok<Answer>(
      r.get(
        `/api/projects/${p.id}/board${stamp ? `?archivedStamp=${encodeURIComponent(stamp)}` : ""}`,
      ),
    );
  return { me, p, r, read };
}

describe("The archived list and its stamp", () => {
  it("a read that sends the stamp of the current list gets no list and the same stamp", async () => {
    const { me, p, r, read } = await setUp();
    const old = await task(me, p.id, "Old work");
    await ok(r.post(`/api/tasks/${old.id}/archive`));

    const whole = await read();
    expect(whole.archived?.map((t) => t.id)).toEqual([old.id]);
    expect(whole.archivedStamp).toMatch(/^[0-9a-f]{32}$/);

    const again = await read(whole.archivedStamp);
    expect(again).not.toHaveProperty("archived");
    expect(again.archivedStamp).toBe(whole.archivedStamp);

    /* A stamp nobody was given is answered with the whole list. */
    const stranger = await read("not-a-stamp");
    expect(stranger.archived?.map((t) => t.id)).toEqual([old.id]);
  });

  it("a read with no stamp carries the whole list, as before", async () => {
    const { me, p, r, read } = await setUp();
    expect((await read()).archived).toEqual([]);
    const old = await task(me, p.id, "Old work");
    await ok(r.post(`/api/tasks/${old.id}/archive`));
    const answer = await read();
    expect(answer.archived).toMatchObject([{ id: old.id, key: old.key, title: "Old work" }]);
    /* Twice the same: nothing about the list moved. */
    expect((await read()).archivedStamp).toBe(answer.archivedStamp);
  });

  it("after an archive, a put back, a rename, a move or a delete, the old stamp gets the whole list", async () => {
    const { me, p, r, read } = await setUp();
    const a = await task(me, p.id, "First");
    const b = await task(me, p.id, "Second");
    let stamp = (await read()).archivedStamp;

    /* Each step changes the list, and a read with the stamp from before it
       is sent the whole list as it is now. */
    const step = async (write: () => Promise<unknown>, ids: string[]) => {
      await write();
      const answer = await read(stamp);
      expect(answer.archived?.map((t) => t.id).sort()).toEqual([...ids].sort());
      expect(answer.archivedStamp).not.toBe(stamp);
      stamp = answer.archivedStamp;
      expect(await read(stamp)).not.toHaveProperty("archived");
      return answer;
    };

    await step(() => ok(r.post(`/api/tasks/${a.id}/archive`)), [a.id]);
    await step(() => ok(r.post(`/api/tasks/${b.id}/archive`)), [a.id, b.id]);
    await step(() => ok(r.del(`/api/tasks/${b.id}/archive`)), [a.id]);
    const renamed = await step(
      () => ok(r.patch(`/api/tasks/${a.id}`, { title: "Renamed" })),
      [a.id],
    );
    expect(renamed.archived?.[0].title).toBe("Renamed");
    /* A rank rewrite can move an archived task and change nothing else of it. */
    await step(() => db.update(tasks).set({ position: "zz" }).where(eq(tasks.id, a.id)), [a.id]);
    const rekeyed = await step(() => ok(r.patch(`/api/projects/${p.id}`, { key: "NEW" })), [a.id]);
    expect(rekeyed.archived?.[0].key).toMatch(/^NEW-/);
    await step(() => ok(r.del(`/api/tasks/${a.id}`)), []);
  });

  it("a parent counts an archived part as done on a read that leaves the list out", async () => {
    const { me, p, r, read } = await setUp();
    const epic = await task(me, p.id, "The epic");
    const done = await task(me, p.id, "Shipped part");
    const open = await task(me, p.id, "Open part");
    const gone = await task(me, p.id, "Deleted part");
    for (const part of [done, open, gone]) {
      await ok(r.put(`/api/tasks/${part.id}/parent`, { parentId: epic.id }));
    }
    await ok(r.post(`/api/tasks/${done.id}/archive`));
    await ok(r.del(`/api/tasks/${gone.id}`));

    const whole = await read();
    const partsOf = (answer: Answer) => answer.tasks.find((t) => t.id === epic.id)?.parts;
    expect(partsOf(whole)).toEqual({ done: 1, total: 2 });

    const light = await read(whole.archivedStamp);
    expect(light).not.toHaveProperty("archived");
    expect(partsOf(light)).toEqual({ done: 1, total: 2 });
  });

  it("the Archived page's read always carries the list", async () => {
    const { me, p, r, read } = await setUp();
    const old = await task(me, p.id, "Old work");
    await ok(r.post(`/api/tasks/${old.id}/archive`));
    const { archivedStamp } = await read();
    const answer = await ok<Answer>(
      r.get(`/api/projects/${p.id}/board?shipped=1&archivedStamp=${archivedStamp}`),
    );
    expect(answer.archived?.map((t) => t.id)).toEqual([old.id]);
    expect(answer.archivedStamp).toBe(archivedStamp);
  });
});
