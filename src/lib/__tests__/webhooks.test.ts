import { beforeEach, describe, expect, it, vi } from "vitest";
import { activity, tasks, webhookDeliveries, webhooks } from "@/db/schema";

/**
 * The funnel with a webhook on the other end of it.
 *
 * What is under test is not the SQL but the road a change takes: one activity
 * row, one queued delivery, and **no network at all** by the time the write is
 * over. A board whose receiver is a shut port has to answer as fast as a board
 * with no webhook, and that is decided here, not in the sender.
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

  return {
    writes,
    db: {
      select: () => builder(),
      insert: (table: unknown) => builder((values) => writes.push({ table, values })),
      update: () => builder(),
      delete: () => builder(),
    },
    answers: (table: unknown, rows: unknown[]) => reads.set(table, rows),
    forget: () => {
      writes.length = 0;
      reads.clear();
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));

const { logActivity } = await import("../activity");

describe("a change that rings a webhook", () => {
  beforeEach(() => {
    fake.forget();
    vi.restoreAllMocks();
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
