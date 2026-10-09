import { describe, expect, it, vi } from "vitest";
import { BULK_LIMIT, batchesSaid, inBatches } from "@/lib/bulk";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, board, ok, person, project, task } = await import("@/test/route");

/*
 * Picking more than one call holds. The route takes two hundred ids at most,
 * and a Shift-click in a long list picks more than that without a word, so the
 * store sends the picks through `inBatches` and words a stop with
 * `batchesSaid`. Here the batches go to the real routes, as the store sends
 * them. Each test was a test of `e2e/pick.spec.ts` and carries its name; the
 * pick itself, a Shift-click and the bar, stayed there.
 */

type Caller = Awaited<ReturnType<typeof person>>;

/** Five hundred tasks, made through the route, in the order a list shows them. */
async function fiveHundred(owner: Caller, projectId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= 500; i += 1) {
    ids.push((await task(owner, projectId, `Row ${String(i).padStart(3, "0")}`)).id);
  }
  return ids;
}

/** One batch as the store posts it: a refusal throws the route's sentence. */
async function post(owner: Caller, path: string, data: unknown) {
  const res = await api(owner).post(path, data);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body;
}

/* Five hundred creates take a second alone and several beside the rest of the
   suite, which is past the default of five. */
describe("Picking more than one call holds", { timeout: 30_000 }, () => {
  it("500 picked tasks archive in one press", async () => {
    const owner = await person();
    const p = await project(owner);
    const ids = await fiveHundred(owner, p.id);

    let calls = 0;
    const run = await inBatches(ids, async (batch) => {
      calls += 1;
      return (await post(owner, `/api/projects/${p.id}/archive`, { taskIds: batch })).archived;
    });

    /* The count is the server's, and the toast says "Archived 500 tasks." */
    expect(run).toEqual({ count: 500, left: [], said: null });
    expect(calls).toBe(3);
    const after = await board(owner, p.id);
    expect(after.tasks).toHaveLength(0);
    expect(after.archived).toHaveLength(500);
  });

  it("a refused batch gives both counts and keeps only what did not go", async () => {
    const owner = await person();
    const p = await project(owner);
    const ids = await fiveHundred(owner, p.id);

    /* Somebody deletes a task of the second batch while it is picked, so the
       first call goes through, the second is refused, and the third is never
       sent. */
    await ok(api(owner).del(`/api/tasks/${ids[BULK_LIMIT + 50]}`));

    let calls = 0;
    const run = await inBatches(ids, async (batch) => {
      calls += 1;
      return (await post(owner, `/api/projects/${p.id}/archive`, { taskIds: batch })).archived;
    });

    expect(calls).toBe(2);
    expect(batchesSaid("Archived", ids.length, run)).toBe(
      "Archived 200 of 500. The rest did not: One of those tasks is not on this board.",
    );
    /* What did not go is what stays picked: the 300 of the batches that were
       refused or never sent. */
    expect(run.left).toEqual(ids.slice(BULK_LIMIT));
    const after = await board(owner, p.id);
    expect(after.archived).toHaveLength(200);
    expect(after.tasks.map((t: { id: string }) => t.id).sort()).toEqual(
      ids
        .slice(BULK_LIMIT)
        .filter((id) => id !== ids[BULK_LIMIT + 50])
        .sort(),
    );
  });

  it("setting a value on 500 picked tasks writes all 500", async () => {
    const owner = await person();
    const p = await project(owner);
    const ids = await fiveHundred(owner, p.id);
    const before = await board(owner, p.id);
    const priority = before.properties.find((x: { name: string }) => x.name === "Priority");
    const urgent = priority.options.find((o: { name: string }) => o.name === "Urgent").id;

    let calls = 0;
    const run = await inBatches(ids, async (batch) => {
      calls += 1;
      await post(owner, `/api/projects/${p.id}/tasks/values`, {
        taskIds: batch,
        propertyId: priority.id,
        value: urgent,
      });
      return batch.length;
    });

    expect(run.said).toBeNull();
    expect(calls).toBe(3);
    /* Really written: every task on the server carries the one option. */
    const after = await board(owner, p.id);
    expect(
      after.tasks.filter(
        (t: { values: Record<string, unknown> }) => t.values[priority.id] === urgent,
      ),
    ).toHaveLength(500);
  });
});

/*
 * Taking a handful of cards off the board is a decision about the board, so
 * the widened route is a person's exactly as the column sweep was. From
 * `e2e/pick.spec.ts`, where the token was made in Settings.
 */
describe("Archiving what is picked", () => {
  it("an agent may not archive the tasks a person picked", async () => {
    const owner = await person("Token Owner");
    const p = await project(owner);
    const made = await task(owner, p.id, "Not for a machine");
    const sweeper = await agent(owner, p.id, "Sweeper");

    const named = await sweeper.api.post(`/api/projects/${p.id}/archive`, { taskIds: [made.id] });
    expect(named.status).toBe(403);

    /* And it archived nothing: the one task is still live. */
    const after = await board(owner, p.id);
    expect(after.tasks.map((t: { id: string }) => t.id)).toContain(made.id);

    /* The task route is the agent's own way, and it still works. */
    const one = await sweeper.api.post(`/api/tasks/${made.id}/archive`, {});
    expect(one.status).toBe(200);
  });
});

/* From `e2e/pick-labels.spec.ts`. What the bar says and sends is
   `Pick.test.tsx`'s. */
describe("Set on a multi-select", () => {
  it("the route changes one option and writes nothing on a task it leaves as it was", async () => {
    const owner = await person();
    const p = await project(owner);
    const read = await board(owner, p.id);
    type Property = { id: string; name: string; options: { id: string; name: string }[] };
    const of = (n: string) => read.properties.find((x: Property) => x.name === n) as Property;
    const option = (x: Property, n: string) => x.options.find((o) => o.name === n)!.id;
    const status = of("Status");
    const labels = of("Labels");
    const [bug, infra, ux, docs] = ["bug", "infra", "ux", "docs"].map((n) => option(labels, n));

    /* Thirty tasks: the even ones carry infra, the odd ones ux and docs, and
       every fifth one bug already. */
    const had: Record<string, string[]> = {};
    for (let i = 0; i < 30; i++) {
      const title = `Task ${String(i).padStart(2, "0")}`;
      const list = i % 2 ? [ux, docs] : [infra];
      if (i % 5 === 0) list.push(bug);
      await ok(
        api(owner).post(`/api/projects/${p.id}/tasks`, {
          title,
          values: { [status.id]: option(status, "Todo"), [labels.id]: list },
        }),
      );
      had[title] = list;
    }
    const ids = (await board(owner, p.id)).tasks.map((t: { id: string }) => t.id);

    const res = await post(owner, `/api/projects/${p.id}/tasks/values`, {
      taskIds: ids,
      propertyId: labels.id,
      value: bug,
      change: "add",
    });
    /* Six carried it already, so twenty-four change. */
    expect(res.set).toBe(24);

    const after = await board(owner, p.id);
    for (const t of after.tasks as { title: string; values: Record<string, string[]> }[]) {
      expect(new Set(t.values[labels.id])).toEqual(new Set([...had[t.title], bug]));
    }

    /* A change on a property that is not a multi-select is refused. */
    const refused = await api(owner).post(`/api/projects/${p.id}/tasks/values`, {
      taskIds: ids,
      propertyId: status.id,
      value: status.options[0].id,
      change: "add",
    });
    expect(refused.status).toBe(400);
  });
});
