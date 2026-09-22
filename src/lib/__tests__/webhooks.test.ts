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
  type Answer = unknown[] | (() => unknown[]);
  type Builder = {
    from: (table: unknown) => Builder;
    innerJoin: () => Builder;
    where: () => Builder;
    orderBy: () => Builder;
    limit: () => Builder;
    set: (values: Values) => Builder;
    returning: () => Builder;
    values: (values: Values | Values[]) => Builder;
    then: (ok: (rows: unknown[]) => unknown, fail?: (e: unknown) => unknown) => Promise<unknown>;
  };

  const writes: { table: unknown; values: Values[] }[] = [];
  /** What a `set()` wrote, in order. An update names no table to read from. */
  const updates: Values[] = [];
  /** How many statements have been made. One statement, one round-trip. */
  let statements = 0;
  /* A read answers by the table it came from. Anything nobody filled in
     answers nothing, which is what a table with no rows looks like. */
  const reads = new Map<unknown, Answer>();
  const rowsOf = (table: unknown): unknown[] => {
    const answer = reads.get(table);
    if (typeof answer === "function") return answer();
    return answer ?? [];
  };

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
      set: (values) => {
        updates.push(values);
        return node;
      },
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
    updates,
    db: {
      select: () => counted(() => builder()),
      insert: (table: unknown) =>
        counted(() => builder((values) => writes.push({ table, values }))),
      update: () => counted(() => builder()),
      delete: () => counted(() => builder()),
      execute: () => counted(() => Promise.resolve({ rows: [] })),
    },
    statements: () => statements,
    answers: (table: unknown, rows: Answer) => reads.set(table, rows),
    forget: () => {
      writes.length = 0;
      updates.length = 0;
      statements = 0;
      reads.clear();
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));

const { logActivity, logActivityAll } = await import("../activity");
const { drainWebhooks } = await import("../webhooks");

/** The sender's own flag, which every test starts with down. */
const sender = globalThis as unknown as { __ushabtiDraining?: boolean };

/** Lets every promise that is ready run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

/** The queue answers one pass. A row the sender took is not due again. */
function once(rows: unknown[]): () => unknown[] {
  let served = false;
  return () => {
    if (served) return [];
    served = true;
    return rows;
  };
}

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

/**
 * The drain, which is off the write path and may take its time — but not
 * everybody's time. One shut port held every project's queue behind it.
 */
describe("the drain", () => {
  /** A delivery as the sender's query answers it. */
  const delivery = (id: string, url: string) => ({
    id,
    body: { delivery: id, kind: "test" },
    tries: 0,
    url,
    secret: "ushs_secret",
  });

  beforeEach(() => {
    /* The receiver is allowed to be anywhere, so no name is resolved here.
       Which addresses may be called is `webhook-address.test.ts`. */
    vi.stubEnv("USHABTI_WEBHOOK_PRIVATE", "1");
  });

  it("sends four at once and no more", async () => {
    let release = () => {};
    const held = new Promise<Response>((done) => {
      release = () => done(new Response("ok"));
    });
    const sent = vi.fn(() => held);
    vi.stubGlobal("fetch", sent);

    const due = Array.from({ length: 20 }, (_, i) =>
      delivery(`delivery-${i}`, `https://box-${i}.example.com/hook`),
    );
    fake.answers(webhookDeliveries, once(due));

    const drained = drainWebhooks();
    await settle();

    /* Four are in flight, one database connection each, and the other sixteen
       wait for a lane rather than for a pass. */
    expect(sent).toHaveBeenCalledTimes(4);

    release();
    await drained;
    expect(sent).toHaveBeenCalledTimes(20);
  });

  it("lets one project's test send past an endpoint that never answers", async () => {
    /* The five second timeout is the sender's; a fake fetch does not keep it,
       so this one hangs until the test is over. That is the endpoint the
       other delivery must not wait for. */
    const hung = new Promise<Response>(() => {});
    const sent = vi.fn((url: string) =>
      url.includes("hung") ? hung : Promise.resolve(new Response("ok")),
    );
    vi.stubGlobal("fetch", sent);

    fake.answers(
      webhookDeliveries,
      once([
        delivery("delivery-hung", "https://hung.example.com/hook"),
        delivery("delivery-test", "https://awake.example.com/hook"),
      ]),
    );

    void drainWebhooks();
    await settle();

    expect(sent.mock.calls.map((call) => call[0])).toEqual([
      "https://hung.example.com/hook",
      "https://awake.example.com/hook",
    ]);
    // The second one is delivered while the first one is still hanging.
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]).toMatchObject({ code: 200 });
    expect(fake.updates[0].deliveredAt).toBeInstanceOf(Date);
  });
});

/**
 * One import, one doorbell.
 *
 * An import writes one feed line on the project and one on every task it
 * made, because the feed is the record and an agent reads it task by task.
 * The doorbell is not the record: two thousand and one deliveries to every
 * receiver for one press of a button is a denial of service dressed as an
 * event. The lines that share an `importId` ring once, and the ring is the
 * line about the project, which is the one carrying the counts.
 */
describe("an import rings once", () => {
  beforeEach(() => {
    fake.answers(webhooks, [{ id: "hook-1", kinds: [], projectKey: "USH" }]);
    fake.answers(tasks, [
      { id: "task-1", number: 31 },
      { id: "task-2", number: 32 },
      { id: "task-3", number: 33 },
    ]);
  });

  it("queues one delivery for a whole import, and it names the project", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const importId = "import-1";

    await logActivityAll([
      {
        projectId: "project-1",
        taskId: null,
        actorId: "person-1",
        kind: "import",
        data: { importId, source: "trello", tasks: 3 },
      },
      ...["task-1", "task-2", "task-3"].map((taskId) => ({
        projectId: "project-1",
        taskId,
        actorId: "person-1",
        kind: "import",
        data: { importId, source: "trello", sourceId: `card-${taskId}` },
      })),
    ]);

    // Every line is in the feed: the record keeps all four.
    expect(fake.writes.find((w) => w.table === activity)!.values).toHaveLength(4);

    const queued = fake.writes.filter((w) => w.table === webhookDeliveries);
    expect(queued).toHaveLength(1);
    expect(queued[0].values).toHaveLength(1);
    const body = queued[0].values[0].body as { kind: string; taskId: string | null };
    expect(body.kind).toBe("import");
    expect(body.taskId).toBeNull();
  });

  it("keeps two imports apart", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await logActivityAll(
      ["import-1", "import-2"].flatMap((importId) => [
        {
          projectId: "project-1",
          taskId: null,
          actorId: "person-1",
          kind: "import",
          data: { importId },
        },
        {
          projectId: "project-1",
          taskId: "task-1",
          actorId: "person-1",
          kind: "import",
          data: { importId },
        },
      ]),
    );

    expect(fake.writes.find((w) => w.table === webhookDeliveries)!.values).toHaveLength(2);
  });

  it("leaves every other line alone", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await logActivityAll([
      { projectId: "project-1", taskId: "task-1", actorId: "person-1", kind: "archive" },
      { projectId: "project-1", taskId: "task-2", actorId: "person-1", kind: "archive" },
    ]);

    // Archiving a column is still one ring per card: nothing folds it.
    expect(fake.writes.find((w) => w.table === webhookDeliveries)!.values).toHaveLength(2);
  });
});
