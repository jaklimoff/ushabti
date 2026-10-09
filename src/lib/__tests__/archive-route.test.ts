import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project, task } = await import("@/test/route");

type Detail = {
  archivedAt: string | null;
  activity: { kind: string; data: Record<string, unknown> }[];
};
type Caller = Awaited<ReturnType<typeof person>>;

/** The task in full, read as the panel reads it. */
async function read(who: Caller, taskId: string): Promise<Detail> {
  return (await ok<{ task: Detail }>(api(who).get(`/api/tasks/${taskId}`))).task;
}

/** How many `archive` lines the history holds for one word. */
function lines(detail: Detail, action: string): number {
  return detail.activity.filter((a) => a.kind === "archive" && a.data.action === action).length;
}

/*
 * Both calls say what the task should be, not what to do to it. An agent that
 * lost the answer and called again is the ordinary case: the board is a
 * network away, and a retry must cost nothing. Each test was a test of
 * `e2e/archive-retry.spec.ts` and carries its name.
 */
describe("Archiving twice", () => {
  it("keeps the first moment and writes one line", async () => {
    const owner = await person();
    const p = await project(owner);
    const { id } = await task(owner, p.id, "Ship the release image");

    await ok(api(owner).post(`/api/tasks/${id}/archive`));
    const first = await read(owner, id);
    expect(first.archivedAt).not.toBeNull();

    expect(await ok(api(owner).post(`/api/tasks/${id}/archive`))).toEqual({ ok: true });

    /* The moment a task went is the one thing its history has to keep, so the
       second call leaves it where it was and says nothing. */
    const after = await read(owner, id);
    expect(after.archivedAt).toBe(first.archivedAt);
    expect(lines(after, "archived")).toBe(1);

    // And the same on the way back.
    await ok(api(owner).del(`/api/tasks/${id}/archive`));
    expect(await ok(api(owner).del(`/api/tasks/${id}/archive`))).toEqual({ ok: true });

    const live = await read(owner, id);
    expect(live.archivedAt).toBeNull();
    expect(lines(live, "restored")).toBe(1);
  });

  it("putting a live task back writes nothing", async () => {
    const owner = await person();
    const p = await project(owner);
    const { id } = await task(owner, p.id, "It was never archived");

    expect(await ok(api(owner).del(`/api/tasks/${id}/archive`))).toEqual({ ok: true });

    const detail = await read(owner, id);
    expect(detail.archivedAt).toBeNull();
    expect(lines(detail, "restored")).toBe(0);
  });
});

/*
 * The cascade behind a delete does not care whether a task is on a board, so
 * a question that counted only the cards would name half the cost. From
 * `e2e/archive.spec.ts`: "the cost of a delete counts the archived tasks
 * too". The numbers are the server's; Settings puts them in its sentences.
 */
describe("Archiving a task", () => {
  it("the cost of a delete counts the archived tasks too", async () => {
    const owner = await person();
    const p = await project(owner);
    const shape = await board(owner, p.id);
    const estimate = shape.properties.find((x: { name: string }) => x.name === "Estimate");
    const xl = estimate.options.find((o: { name: string }) => o.name === "XL").id;

    for (const title of ["Live estimate", "Archived estimate"]) {
      const { id } = await task(owner, p.id, title);
      await ok(api(owner).put(`/api/tasks/${id}/values/${estimate.id}`, { value: xl }));
      if (title === "Archived estimate") await ok(api(owner).post(`/api/tasks/${id}/archive`));
    }

    // One card left on the board, two values in the project.
    expect((await board(owner, p.id)).tasks).toHaveLength(1);

    // "Delete Estimate? 5 options and 2 values go with it."
    expect(await ok(api(owner).get(`/api/properties/${estimate.id}/count`))).toEqual({
      values: 2,
    });

    // And the key rename counts them as well: "2 tasks are called …".
    const settings = await ok(api(owner).get(`/api/projects/${p.id}/settings`));
    expect(settings.taskCount).toBe(2);
  });
});
