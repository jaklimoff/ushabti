import { beforeEach, describe, expect, it, vi } from "vitest";
import { activity, agentRunLog } from "@/db/schema";

/**
 * The sweep is a server module, so the test hands it a database that writes
 * nothing and remembers everything. What is being checked is not the SQL but
 * the road the row takes: one activity row, and it goes through `logActivity`.
 */
const fake = vi.hoisted(() => {
  type Values = Record<string, unknown>;
  type Builder = {
    set: () => Builder;
    where: () => Builder;
    returning: () => Builder;
    values: (values: Values) => Builder;
    from: () => Builder;
    innerJoin: () => Builder;
    orderBy: () => Builder;
    limit: () => Builder;
    then: (ok: (rows: Values[]) => unknown, fail?: (error: unknown) => unknown) => Promise<unknown>;
  };

  const writes: { table: unknown; values: Values }[] = [];
  let lost: Values[] = [];

  const builder = (rows: () => Values[], note?: (values: Values) => void): Builder => {
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
      orderBy: () => node,
      limit: () => node,
      then: (ok, fail) => Promise.resolve(rows()).then(ok, fail),
    };
    return node;
  };

  return {
    writes,
    db: {
      // The sweep's UPDATE ... RETURNING hands back the runs it closed.
      update: () => builder(() => lost),
      insert: (table: unknown) =>
        builder(
          () => [],
          (values) => writes.push({ table, values }),
        ),
      // Nothing is open afterwards, which is the whole point of the sweep.
      select: () => builder(() => []),
    },
    sweeps: (rows: Values[]) => {
      lost = rows;
    },
    forget: () => {
      writes.length = 0;
      lost = [];
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
const { loadOpenRuns } = await import("../runs");

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
    // words the sweep wrote before.
    expect(rows[0].values).toEqual({
      projectId: "project-1",
      taskId: "task-1",
      actorId: "agent-1",
      kind: "run",
      data: { action: "lost" },
    });

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
