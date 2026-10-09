import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/db");
const { api, board, ok, person, project, task } = await import("@/test/route");

/*
 * What a delete and its put back answer and leave in the rows. Each test was
 * a test of `e2e/undo-delete.spec.ts` and carries its name; the way round
 * through the board and the drawer stayed there, and the toast and the
 * drawer on a phone are `UndoDelete.test.tsx`.
 */

/**
 * Moves a deleted row back in time.
 *
 * The window is thirty days and a test cannot wait that long. It must not be
 * able to shorten the window either, because the window is the rule under
 * test, so it moves the moment the row carries instead — which is what an old
 * delete looks like from the outside.
 */
async function backdateDelete(taskId: string, days: number): Promise<void> {
  await db.execute(sql`
    update tasks set deleted_at = now() - (${String(days)} || ' days')::interval
     where id = ${taskId} and deleted_at is not null`);
}

describe("Undoing a delete", () => {
  /*
   * What delete means to whoever holds the id. Every route about the task
   * answers `404`, because the task is gone; put back is the one way out, and
   * it is the one route that may still see it.
   */
  it("every route about a deleted task answers 404, and restore answers 200", async () => {
    const owner = await person();
    const p = await project(owner);
    const { id } = await task(owner, p.id, "Write the offline queue tests");
    const propertyId: string = (await board(owner, p.id)).properties[0].id;
    const as = api(owner);

    const said = await ok(as.del(`/api/tasks/${id}`));
    expect(said.ok).toBe(true);
    // The answer says how long there is, so a caller needs nothing else.
    expect(Date.parse(said.goesAt)).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

    const gone = [
      await as.get(`/api/tasks/${id}`),
      await as.patch(`/api/tasks/${id}`, { title: "No" }),
      await as.del(`/api/tasks/${id}`),
      await as.put(`/api/tasks/${id}/values/${propertyId}`, { value: null }),
      await as.post(`/api/tasks/${id}/checklist`, { text: "No" }),
      await as.post(`/api/tasks/${id}/comments`, { body: "No" }),
      await as.post(`/api/tasks/${id}/run`, { goal: "No" }),
      await as.post(`/api/tasks/${id}/move`, {}),
      await as.post(`/api/tasks/${id}/archive`, {}),
    ];
    for (const answer of gone) {
      expect(answer.status, `${answer.url} should not answer for a deleted task`).toBe(404);
    }

    // It is not on the board answer either, live or archived.
    const after = await board(owner, p.id);
    expect(after.tasks).toHaveLength(0);
    expect(after.archived).toHaveLength(0);

    // The drawer has it, and the way out works twice.
    const drawer = await ok(as.get(`/api/projects/${p.id}/deleted`));
    expect(drawer.deleted.map((t: { id: string }) => t.id)).toEqual([id]);
    expect(drawer.windowDays).toBe(30);

    expect((await as.post(`/api/tasks/${id}/restore`)).status).toBe(200);
    expect((await as.post(`/api/tasks/${id}/restore`)).status).toBe(200);
    expect((await as.get(`/api/tasks/${id}`)).status).toBe(200);
  });

  /*
   * The feed is the record, and a receiver watching `deleted` now hears a put
   * back too. It has to be able to tell them apart without reading the task,
   * which it cannot: the line carries no task id, because the activity row
   * would be swept away with the task it names.
   */
  it("the deleted feed line says which way round it went", async () => {
    const owner = await person();
    const p = await project(owner);
    const { id, key } = await task(owner, p.id, "Ship the release image");

    const from = new Date(Date.now() - 1000).toISOString();
    await ok(api(owner).del(`/api/tasks/${id}`));
    await ok(api(owner).post(`/api/tasks/${id}/restore`));

    const feed = await ok(api(owner).get(`/api/projects/${p.id}/activity?after=${from}`));
    const lines = feed.entries.filter((e: { kind: string }) => e.kind === "deleted");

    expect(lines).toHaveLength(2);
    expect(lines[0].taskId).toBeNull();
    expect(lines[0].data.action).toBe("deleted");
    expect(lines[0].data.key).toBe(key);
    expect(typeof lines[0].data.goesAt).toBe("string");
    expect(lines[1].data.action).toBe("restored");
    expect(lines[1].data.key).toBe(key);
    expect(lines[1].data.goesAt).toBeNull();
  });

  /* The two marks are separate answers to separate questions. The drawer
     draws its archived rows from the board's own list. */
  it("a task deleted while it was archived comes back archived", async () => {
    const owner = await person();
    const p = await project(owner);
    const { id, key } = await task(owner, p.id, "Rate limit the sign-in route");

    await ok(api(owner).post(`/api/tasks/${id}/archive`));
    await ok(api(owner).del(`/api/tasks/${id}`));
    expect((await board(owner, p.id)).archived).toHaveLength(0);

    await ok(api(owner).post(`/api/tasks/${id}/restore`));

    // Back where it was, which was the archive and not the board.
    const after = await board(owner, p.id);
    expect(after.archived.map((t: { key: string }) => t.key)).toEqual([key]);
    expect(after.tasks).toHaveLength(0);
  });

  /*
   * The sweep runs on the write and on the read of the drawer, and there is no
   * timer. So a row past its window goes the next time somebody deletes
   * anything or opens this page — never a day later on a clock nobody runs.
   */
  it("a task past its thirty days is swept when the drawer is read", async () => {
    const owner = await person();
    const p = await project(owner);
    const old = await task(owner, p.id, "Old enough to go");
    await ok(api(owner).del(`/api/tasks/${old.id}`));
    const young = await task(owner, p.id, "Still inside the window");
    await ok(api(owner).del(`/api/tasks/${young.id}`));

    await backdateDelete(old.id, 31);

    const drawer = await ok(api(owner).get(`/api/projects/${p.id}/deleted`));
    expect(drawer.deleted.map((t: { key: string }) => t.key)).toEqual([young.key]);

    // Swept means gone, not hidden: the row is not in the table any more.
    const left = await db.execute(sql`select 1 from tasks where id = ${old.id}`);
    expect(left.rows).toHaveLength(0);
  });
});
