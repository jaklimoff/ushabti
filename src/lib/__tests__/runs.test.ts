import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activity, agentRunLog } from "@/db/schema";

/**
 * The runs module is a server module, so the test hands it a database that
 * writes nothing and remembers everything: what was written, and what each
 * SELECT asked for. The sweep tests read the road a row takes; the history
 * tests read how many statements the answer took and in which order it comes.
 */
const fake = vi.hoisted(() => {
  type Values = Record<string, unknown>;
  type Asked = { order: unknown[]; limit: number | null };
  type Builder = {
    set: () => Builder;
    where: () => Builder;
    returning: () => Builder;
    values: (values: Values) => Builder;
    from: () => Builder;
    innerJoin: () => Builder;
    orderBy: (...order: unknown[]) => Builder;
    limit: (n: number) => Builder;
    then: (ok: (rows: Values[]) => unknown, fail?: (error: unknown) => unknown) => Promise<unknown>;
  };

  const writes: { table: unknown; values: Values }[] = [];
  const asked: Asked[] = [];
  let lost: Values[] = [];
  let held: Values[] = [];

  const builder = (
    rows: () => Values[],
    note?: (values: Values) => void,
    reads?: Asked,
  ): Builder => {
    const node: Builder = {
      set: () => node,
      where: () => node,
      returning: () => node,
      values: (values) => {
        note?.(values);
        return node;
      },
      from: () => node,
      innerJoin: () => node,
      orderBy: (...order) => {
        if (reads) reads.order = order;
        return node;
      },
      limit: (n) => {
        if (reads) reads.limit = n;
        return node;
      },
      then: (ok, fail) => Promise.resolve(rows()).then(ok, fail),
    };
    return node;
  };

  return {
    writes,
    asked,
    db: {
      // The sweep's UPDATE ... RETURNING hands back the runs it closed.
      update: () => builder(() => lost),
      insert: (table: unknown) =>
        builder(
          () => [],
          (values) => writes.push({ table, values }),
        ),
      /* The first read of a call is the one for the runs; anything after it
         is a second table, which the history must never need. Nothing is
         open after a sweep, which is the whole point of the sweep. */
      select: () => {
        const reads: Asked = { order: [], limit: null };
        asked.push(reads);
        const first = asked.length === 1;
        return builder(() => (first ? held : []), undefined, reads);
      },
    },
    sweeps: (rows: Values[]) => {
      lost = rows;
    },
    holds: (rows: Values[]) => {
      held = rows;
    },
    forget: () => {
      writes.length = 0;
      asked.length = 0;
      lost = [];
      held = [];
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("../events", () => ({ publish: vi.fn() }));
// The real funnel, watched. A direct insert would write the row without it.
vi.mock("../activity", async (importOriginal) => {
  const real = await importOriginal<typeof import("../activity")>();
  return { logActivity: vi.fn(real.logActivity) };
});

const { logActivity } = await import("../activity");
const { loadOpenRuns, loadTaskRuns } = await import("../runs");

/** The ORDER BY of one read, in the words Postgres is handed. */
function orderOf(reads: { order: unknown[] }): string {
  const parts = reads.order as Parameters<typeof sql.join>[0];
  return new PgDialect().sqlToQuery(sql.join(parts, sql.raw(", "))).sql;
}

describe("the lease closing a run nobody answered for", () => {
  beforeEach(() => {
    fake.forget();
    vi.mocked(logActivity).mockClear();
  });

  it("writes one activity row, and writes it through logActivity", async () => {
    fake.sweeps([{ id: "run-1", projectId: "project-1", taskId: "task-1", agentId: "agent-1" }]);

    await loadOpenRuns("project-1");

    const rows = fake.writes.filter((w) => w.table === activity);
    expect(rows).toHaveLength(1);
    expect(logActivity).toHaveBeenCalledTimes(1);

    // The feed reads the line from the kind and the action, so both are the
    // words the sweep wrote before. The funnel writes a list, because one
    // write can touch many tasks, and stamps the moment itself so that the
    // webhook it rings names exactly the row a receiver will read back.
    const written = rows[0].values as unknown as Record<string, unknown>[];
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      projectId: "project-1",
      taskId: "task-1",
      actorId: "agent-1",
      kind: "run",
      data: { action: "lost" },
    });
    expect(written[0].createdAt).toBeInstanceOf(Date);

    // The run's own log still says it in plain words.
    const log = fake.writes.filter((w) => w.table === agentRunLog);
    expect(log).toHaveLength(1);
    expect(log[0].values.text).toBe("no word from the agent, so the board closed the run");
  });

  it("writes nothing when no run missed its lease", async () => {
    fake.sweeps([]);

    await loadOpenRuns("project-1");

    expect(fake.writes).toHaveLength(0);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("the runs of one task", () => {
  beforeEach(() => {
    fake.forget();
    fake.sweeps([]);
  });

  it("puts the history in the order its rows read", async () => {
    await loadTaskRuns("task-1");

    // A row prints how long ago the run started, so the list is newest start
    // first. The id keeps two runs that started together in one order.
    const history = fake.asked[1];
    expect(orderOf(history)).toBe('"agent_runs"."started_at" desc, "agent_runs"."id" desc');
  });
});
