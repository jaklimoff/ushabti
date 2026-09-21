import { beforeEach, describe, expect, it, vi } from "vitest";
import { activity, tasks, webhookDeliveries, webhooks } from "@/db/schema";

/**
 * The funnel with a webhook on the other end of it.
 *
 * What is under test is not the SQL but the road a change takes: one activity
 * row, one queued delivery, and **no network at all** by the time the write is
 * over. A board whose receiver is a shut port has to answer as fast as a board
 * with no webhook, and that is decided here, not in the sender.
 *
 * The fake counts its statements as well as answering them, because what the
 * write costs is part of the road: a second webhook must not cost the writer
 * another round-trip.
 */
const fake = vi.hoisted(() => {
  type Values = Record<string, unknown>;
  type Builder = {
    from: (table: unknown) => Builder;
    innerJoin: () => Builder;
    where: () => Builder;
    orderBy: () => Builder;
    limit: () => Builder;
    set: () => Builder;
    returning: () => Builder;
    values: (values: Values | Values[]) => Builder;
    then: (ok: (rows: unknown[]) => unknown, fail?: (e: unknown) => unknown) => Promise<unknown>;
  };

  const writes: { table: unknown; values: Values[] }[] = [];
  /** How many statements have been made. One statement, one round-trip. */
  let statements = 0;
  /* A read answers by the table it came from. Anything nobody filled in
     answers nothing, which is what a table with no rows looks like. */
  const reads = new Map<unknown, unknown[]>();
  const rowsOf = (table: unknown): unknown[] => reads.get(table) ?? [];

  const builder = (note?: (values: Values[]) => void): Builder => {
    let table: unknown = null;
    const node: Builder = {
      from: (t) => {
        table = t;
        return node;
      },
      innerJoin: () => node,
      where: () => node,
      orderBy: () => node,
      limit: () => node,
      set: () => node,
      returning: () => node,
      values: (values) => {
        note?.(Array.isArray(values) ? values : [values]);
        return node;
      },
      then: (ok, failed) => Promise.resolve(rowsOf(table)).then(ok, failed),
    };
    return node;
  };

  const counted = <T>(make: () => T): T => {
    statements += 1;
    return make();
  };

  return {
    writes,
    db: {
      select: () => counted(() => builder()),
      insert: (table: unknown) =>
        counted(() => builder((values) => writes.push({ table, values }))),
      update: () => counted(() => builder()),
      delete: () => counted(() => builder()),
      execute: () => counted(() => Promise.resolve({ rows: [] })),
    },
    statements: () => statements,
    answers: (table: unknown, rows: unknown[]) => reads.set(table, rows),
    forget: () => {
      writes.length = 0;
      statements = 0;
      reads.clear();
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));

const { logActivity } = await import("../activity");

/** The sender's own flag, which every test starts with down. */
const sender = globalThis as unknown as { __ushabtiDraining?: boolean };

beforeEach(() => {
  fake.forget();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  sender.__ushabtiDraining = false;
});

describe("a change that rings a webhook", () => {
  beforeEach(() => {
    // One live webhook that rings for every kind, and the task it will name.
    fake.answers(webhooks, [{ id: "hook-1", kinds: [], projectKey: "USH" }]);
    fake.answers(tasks, [{ id: "task-1", number: 31 }]);
  });

  it("queues one row and touches no network before the write is over", async () => {
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);

    await logActivity({
      projectId: "project-1",
      taskId: "task-1",
      actorId: "person-1",
      kind: "comment",
    });

    // The write is over. Nothing has been sent, and nothing was waited for:
    // this is what "a dead endpoint costs one INSERT" means.
    expect(sent).not.toHaveBeenCalled();

    const lines = fake.writes.filter((w) => w.table === activity);
    expect(lines).toHaveLength(1);

    const queued = fake.writes.filter((w) => w.table === webhookDeliveries);
    expect(queued).toHaveLength(1);
    expect(queued[0].values).toHaveLength(1);
  });

  it("puts the doorbell in the body, and never the change", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await logActivity({
      projectId: "project-1",
      taskId: "task-1",
      actorId: "person-1",
      kind: "comment",
      data: { body: "the words of the comment" },
    });

    const queued = fake.writes.filter((w) => w.table === webhookDeliveries);
    const body = queued[0].values[0].body as Record<string, unknown>;

    expect(body).toMatchObject({
      projectId: "project-1",
      projectKey: "USH",
      kind: "comment",
      taskId: "task-1",
      taskKey: "USH-31",
    });
    expect(typeof body.delivery).toBe("string");
    // Nothing of what changed reaches the receiver. It reads the feed.
    expect(JSON.stringify(body)).not.toContain("the words of the comment");
  });

  it("names the moment the feed line carries, so a reader lands on it", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await logActivity({
      projectId: "project-1",
      taskId: null,
      actorId: "person-1",
      kind: "reset",
    });

    const line = fake.writes.find((w) => w.table === activity)!.values[0];
    const body = fake.writes.find((w) => w.table === webhookDeliveries)!.values[0].body as {
      at: string;
      taskId: string | null;
      taskKey: string | null;
    };

    expect(body.at).toBe((line.createdAt as Date).toISOString());
    // A line about the project rather than about a task carries no key.
    expect(body.taskId).toBeNull();
    expect(body.taskKey).toBeNull();
  });
});

/**
 * What the write pays, counted.
 *
 * The sweep used to be a SELECT and a DELETE for each webhook that rang, so
 * one webhook cost six statements and five cost fourteen. It is one statement
 * now, whoever rang: five statements, and the second webhook is free.
 */
describe("what a write costs", () => {
  /** Writes one line with `hooks` live webhooks on the project. */
  async function costOf(hooks: number): Promise<number> {
    fake.forget();
    fake.answers(
      webhooks,
      Array.from({ length: hooks }, (_, i) => ({ id: `hook-${i}`, kinds: [], projectKey: "USH" })),
    );
    fake.answers(tasks, [{ id: "task-1", number: 31 }]);
    /* A drain is running, so the kick at the end of the write does nothing.
       What is left is the write path itself, which is what is counted. */
    sender.__ushabtiDraining = true;

    await logActivity({
      projectId: "project-1",
      taskId: "task-1",
      actorId: "person-1",
      kind: "comment",
    });
    return fake.statements();
  }

  it("costs the same whether one webhook rings or five", async () => {
    vi.stubGlobal("fetch", vi.fn());

    /* The activity row, the webhooks of the project, the numbers of the tasks
       named, the queued deliveries, and the sweep. */
    expect(await costOf(1)).toBe(5);
    expect(await costOf(5)).toBe(5);
    expect(await costOf(20)).toBe(5);
  });

  it("costs nothing beyond the read that answers nothing when no hook rings", async () => {
    vi.stubGlobal("fetch", vi.fn());

    // The activity row and the read that finds no webhook. Nothing else.
    expect(await costOf(0)).toBe(2);
  });
});
