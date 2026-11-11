import { describe, expect, it, vi } from "vitest";
import { rankSpread } from "@/lib/rank";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db, pool } = await import("@/test/db");
const { tasks } = await import("@/db/schema");
const { archivedTaskRows, liveTaskRows, neighbourRead } = await import("@/lib/queries");
const { api, board, ok, person, project } = await import("@/test/route");

/** Enough rows that a plan which reads them all would show it. */
const ROWS = 2_000;

/**
 * The plan of one read, with the table scans that would hide a missing index
 * switched off: on a small table the planner rightly prefers them, and then
 * the plan says nothing about whether the index could hand back the order.
 * `analyze` runs the read too, so the plan says how many rows it touched.
 */
async function planOf(
  query: { toSQL(): { sql: string; params: unknown[] } },
  analyze = false,
): Promise<string> {
  const { sql, params } = query.toSQL();
  await pool.query("begin");
  try {
    await pool.query("set local enable_seqscan = off");
    await pool.query("set local enable_bitmapscan = off");
    const answer = (await pool.query(
      `explain (costs off${analyze ? ", analyze, timing off, summary off" : ""}) ${sql}`,
      params,
    )) as { rows: Record<string, string>[] };
    return answer.rows.map((r) => Object.values(r)[0]).join("\n");
  } finally {
    await pool.query("rollback");
  }
}

async function seeded() {
  const owner = await person();
  const p = await project(owner);
  const ranks = rankSpread(null, ROWS);
  const archived = new Date();
  for (let at = 0; at < ROWS; at += 500) {
    await db.insert(tasks).values(
      ranks.slice(at, at + 500).map((position, i) => ({
        projectId: p.id,
        number: 10_000 + at + i,
        title: `Seed ${at + i}`,
        position,
        createdBy: owner.id,
        /* Most of a long-lived project is archived. */
        archivedAt: (at + i) % 4 === 0 ? null : archived,
      })),
    );
  }
  await pool.query("analyze tasks");
  return { owner, p, ranks };
}

describe("The rank order comes from an index", { timeout: 60_000 }, () => {
  it("reads a board's archived tasks in rank order off the position index, with no sort", async () => {
    const { p } = await seeded();
    const plan = await planOf(archivedTaskRows(p.id, false));
    expect(plan).toMatch(/Index Scan using tasks_project_position_idx on tasks/);
    expect(plan).not.toMatch(/Sort/);
  });

  it("finds a board's live tasks through the live index", async () => {
    const { p } = await seeded();
    const plan = await planOf(liveTaskRows(p.id));
    /* The counts join by hash, which keeps no order, so the live rows are
       sorted once after it. The rows themselves come off the partial index,
       and no archived row is read to find them. */
    expect(plan).toMatch(/Index Scan using tasks_project_live_idx on tasks\n/);
  });

  it("finds a neighbour by reading one row of the position index", async () => {
    const { p, ranks } = await seeded();
    const [at] = await db
      .select({ id: tasks.id, position: tasks.position, number: tasks.number })
      .from(tasks)
      .where((await import("drizzle-orm")).eq(tasks.position, ranks[ROWS / 2]));

    const down = await planOf(neighbourRead(db as never, p.id, at, "down"), true);
    expect(down).toMatch(/Index Scan using tasks_project_position_idx on tasks .*rows=1\.00 /);
    expect(down).not.toMatch(/Sort/);

    const up = await planOf(neighbourRead(db as never, p.id, at, "up", at.id), true);
    expect(up).toMatch(
      /Index Scan Backward using tasks_project_position_idx on tasks .*rows=1\.00 /,
    );
    expect(up).not.toMatch(/Sort/);

    /* The last task of the project, which is all an append reads. */
    const last = await planOf(neighbourRead(db as never, p.id, null, "up"), true);
    expect(last).toMatch(
      /Index Scan Backward using tasks_project_position_idx on tasks .*rows=1\.00 /,
    );
    expect(last).not.toMatch(/Sort/);
  });

  it("drops the two indexes another one already covers", async () => {
    const answer = (await pool.query(
      "select indexname from pg_indexes where indexname in ('activity_project_idx', 'agent_run_log_run_idx')",
    )) as { rows: unknown[] };
    expect(answer.rows).toEqual([]);
  });
});

describe("A task lands between the neighbours it was given", { timeout: 30_000 }, () => {
  async function titles(owner: Awaited<ReturnType<typeof person>>, projectId: string) {
    const read = (await board(owner, projectId)) as {
      tasks: { title: string; position: string; number: number }[];
    };
    return read.tasks
      .filter((t) => /^[A-Z]$/.test(t.title))
      .sort((a, b) =>
        a.position === b.position ? a.number - b.number : a.position < b.position ? -1 : 1,
      )
      .map((t) => t.title)
      .join("");
  }

  it("on a create and on a move, archived rows and all", async () => {
    const owner = await person();
    const p = await project(owner);
    const make = async (title: string, extra: Record<string, unknown> = {}) =>
      (
        await ok<{ task: { id: string } }>(
          api(owner).post(`/api/projects/${p.id}/tasks`, { title, ...extra }),
        )
      ).task.id;
    const move = (id: string, to: Record<string, unknown>) =>
      ok(api(owner).post(`/api/tasks/${id}/move`, to));

    const a = await make("A");
    const c = await make("C");
    await make("B", { afterId: a });
    await make("Z", { atTop: true });
    await make("D", { afterId: c });
    expect(await titles(owner, p.id)).toBe("ZABCD");

    /* An archived task still holds its rank, so a task lands around it. */
    const gone = await make("Archived");
    await ok(api(owner).post(`/api/tasks/${gone}/archive`, {}));
    await make("E");
    expect(await titles(owner, p.id)).toBe("ZABCDE");

    const z = (await db.select({ id: tasks.id, title: tasks.title }).from(tasks)).find(
      (t) => t.title === "Z",
    )!.id;
    await move(z, { beforeId: c });
    expect(await titles(owner, p.id)).toBe("ABZCDE");
    await move(z, { afterId: a });
    expect(await titles(owner, p.id)).toBe("AZBCDE");
    await move(a, {});
    expect(await titles(owner, p.id)).toBe("ZBCDEA");
    await move(a, { beforeId: z });
    expect(await titles(owner, p.id)).toBe("AZBCDE");
    /* A move onto itself names no neighbour, as before. */
    await move(c, { afterId: c });
    expect((await titles(owner, p.id)).length).toBe(6);
    /* An id that is not one names no task, and is not an error. */
    await make("F", { afterId: "not-an-id" });
    expect(await titles(owner, p.id)).toMatch(/F$/);
  });
});
