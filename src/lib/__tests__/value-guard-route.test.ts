import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/db");
const { tasks } = await import("@/db/schema");
const { api, board, ok, person, project, task } = await import("@/test/route");

/*
 * A value is checked before anything is written. A word where an id belongs
 * used to reach Postgres and come back as a 500; a day the calendar does not
 * have was stored and drawn as another day; and a move wrote its rank in one
 * transaction and its value in a second, so a refused value left the card
 * moved in its old column.
 */

type Property = { id: string; name: string; type: string; options: { id: string }[] };

async function said(answer: Promise<Response>): Promise<[number, string]> {
  const res = await answer;
  const { error } = (await res.json()) as { error: string };
  return [res.status, error];
}

async function setUp() {
  const me = await person();
  const p = await project(me);
  const r = api(me);
  await ok(r.post(`/api/projects/${p.id}/properties`, { name: "Due", type: "date" }));
  await ok(r.post(`/api/projects/${p.id}/properties`, { name: "Owner", type: "person" }));
  const props = (await board(me, p.id)).properties as Property[];
  const of = (name: string) => props.find((x) => x.name === name)!;
  return { me, p, r, status: of("Status"), due: of("Due"), owner: of("Owner") };
}

async function rankOf(id: string) {
  const [row] = await db.select({ position: tasks.position }).from(tasks).where(eq(tasks.id, id));
  return row.position;
}

describe("A value that cannot be stored", () => {
  it("is a 400 when it names an option or a person by something that is not an id", async () => {
    const { p, r, status, owner } = await setUp();
    const made = r.post(`/api/projects/${p.id}/tasks`, {
      title: "Bad option",
      values: { [status.id]: "not-a-uuid" },
    });
    expect(await said(made)).toEqual([400, "One of the options does not exist any more."]);

    const mine = await ok<{ task: { id: string } }>(
      r.post(`/api/projects/${p.id}/tasks`, { title: "Has an owner" }),
    );
    const put = r.put(`/api/tasks/${mine.task.id}/values/${owner.id}`, { value: "nobody" });
    expect(await said(put)).toEqual([400, "That person is not a member of this project."]);
  });

  it("is a 400 when the date is not a real day", async () => {
    const { p, r, due } = await setUp();
    const made = r.post(`/api/projects/${p.id}/tasks`, {
      title: "Bad day",
      values: { [due.id]: "2026-02-31" },
    });
    expect(await said(made)).toEqual([400, "Due needs a date like 2026-08-21."]);

    const fine = await ok<{ task: { id: string } }>(
      r.post(`/api/projects/${p.id}/tasks`, {
        title: "Leap day",
        values: { [due.id]: "2028-02-29" },
      }),
    );
    expect(fine.task.id).toBeTruthy();
    const nextYear = r.put(`/api/tasks/${fine.task.id}/values/${due.id}`, { value: "2027-02-29" });
    expect((await nextYear).status).toBe(400);
  });

  it("refused on a move, leaves the task's rank where it was", async () => {
    const { me, p, r, status } = await setUp();
    const first = await task(me, p.id, "First");
    const second = await task(me, p.id, "Second");
    const before = await rankOf(second.id);

    const moved = r.post(`/api/tasks/${second.id}/move`, {
      beforeId: first.id,
      values: { [status.id]: "not-a-uuid" },
    });
    expect((await moved).status).toBe(400);
    expect(await rankOf(second.id)).toBe(before);

    /* A good value moves both together. */
    const done = status.options.at(-1)!.id;
    await ok(
      r.post(`/api/tasks/${second.id}/move`, { beforeId: first.id, values: { [status.id]: done } }),
    );
    expect((await rankOf(second.id)) < (await rankOf(first.id))).toBe(true);
    const read = (await board(me, p.id)).tasks as { id: string; values: Record<string, unknown> }[];
    expect(read.find((t) => t.id === second.id)!.values[status.id]).toBe(done);
  });
});
