import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, person, project, task } = await import("@/test/route");

/*
 * Every id on the board is a UUID. Postgres refuses to cast anything else, and
 * the refusal used to reach the caller as `500 Something went wrong on the
 * server.` — our fault, for a request that was merely wrong. One helper reads
 * the shape first, so every route that takes an id answers the same way.
 *
 * `readId` itself has unit tests; these say each door asks it. They were
 * `e2e/bad-id.spec.ts`, and carry its names.
 */

const BAD = "not-a-uuid";

/** The status and the sentence, as a caller reads them. */
async function said(answer: Promise<Response>): Promise<[number, string]> {
  const res = await answer;
  const { error } = (await res.json()) as { error: string };
  return [res.status, error];
}

describe("An id that is not a UUID", () => {
  it("is refused with a sentence, wherever it is in the path", async () => {
    const me = await person();
    const p = await project(me);
    const r = api(me);

    // A task.
    expect(await said(r.get(`/api/tasks/${BAD}`))).toEqual([400, "That is not a task id."]);

    // A run.
    expect(await said(r.get(`/api/runs/${BAD}`))).toEqual([400, "That is not a run id."]);

    // A view.
    expect(await said(r.patch(`/api/views/${BAD}`, { name: "Anything" }))).toEqual([
      400,
      "That is not a view id.",
    ]);

    /* A run's control word. This route reads the run by hand rather than
       through `runContext`, which is how it kept its 500 the first time. */
    expect(await said(r.post(`/api/runs/${BAD}/control`, { control: "pause" }))).toEqual([
      400,
      "That is not a run id.",
    ]);

    /* A lens. This route reads the view in one go, for the project and the
       rules at once, so it reads the id above that read rather than through
       `viewProjectId`. */
    expect(await said(r.put(`/api/views/${BAD}/lens`, { filters: null }))).toEqual([
      400,
      "That is not a view id.",
    ]);

    // And the project itself, which every project route reads through `guard`.
    expect(await said(r.get(`/api/projects/${BAD}/board`))).toEqual([
      400,
      "That is not a project id.",
    ]);

    /* The second id in a path is read the same way. This is the main agent
       write, and it is the one the API page promises 400 for. */
    const made = await task(me, p.id, "Read the id first");
    expect(await said(r.put(`/api/tasks/${made.id}/values/${BAD}`, {}))).toEqual([
      400,
      "That is not a property id.",
    ]);
  });

  /* A body is a path the long way round. The bulk write names its tasks in
     one, so it reads them by the same shape and refuses the whole call. */
  it("is refused in a body as well", async () => {
    const me = await person();
    const p = await project(me);
    const r = api(me);
    const made = await task(me, p.id, "Pick me");

    expect(
      await said(
        r.post(`/api/projects/${p.id}/tasks/values`, {
          taskIds: [made.id, BAD],
          propertyId: BAD,
          value: null,
        }),
      ),
    ).toEqual([400, "Name the tasks as a list of ids."]);

    // And the property it names, which is one id rather than a list.
    expect(
      await said(
        r.post(`/api/projects/${p.id}/tasks/values`, {
          taskIds: [made.id],
          propertyId: BAD,
          value: null,
        }),
      ),
    ).toEqual([400, "That is not a property id."]);
  });
});
