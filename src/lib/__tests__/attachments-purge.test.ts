import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A file's object leaves the bucket when its row leaves the table, whichever
 * way that happens, and a file on a task in the drawer is hidden with it.
 *
 * Drizzle runs for real over a fake client, so a test reads the statements
 * and hands back the rows each one returns.
 */
const fake = vi.hoisted(() => ({
  sql: [] as string[],
  removed: [] as string[],
  /** The rows a statement returns, by a word it contains. */
  answer: (_text: string): unknown[][] => [],
  hold: null as null | Promise<void>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  const client = {
    query: async (q: string | { text: string }) => {
      const text = typeof q === "string" ? q : q.text;
      fake.sql.push(text);
      return { rows: fake.answer(text), rowCount: 0, fields: [] };
    },
  };
  return { db: drizzle(client as never, { schema }) };
});
vi.mock("@/lib/storage", () => ({
  removeObject: async (key: string) => {
    if (fake.hold) await fake.hold;
    fake.removed.push(key);
  },
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...real,
    requireActor: async () => ({ id: "u-owner", kind: "human", tokenProjectId: null }),
    requireMembership: async (_u: string, projectId: string) => ({ projectId, role: "owner" }),
  };
});
vi.mock("@/lib/events", () => ({ publish: vi.fn() }));

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ID = "44444444-4444-4444-8444-444444444444";

const { attachmentRow, removeObjects, sweepUnready } = await import("@/lib/attachment-rows");
const { sweepDeleted } = await import("@/lib/queries");
const projectRoute = await import("@/app/api/projects/[projectId]/route");
const { readKinds } = await import("@/lib/webhook-delivery");

const settle = () => new Promise((done) => setTimeout(done, 20));

beforeEach(() => {
  for (const [k, v] of Object.entries({ S3_BUCKET: "b", S3_ACCESS_KEY: "k", S3_SECRET_KEY: "s" }))
    vi.stubEnv(k, v);
  fake.sql = [];
  fake.removed = [];
  fake.hold = null;
  fake.answer = () => [];
});
afterEach(() => vi.unstubAllEnvs());

describe("a purge takes the objects with the rows", () => {
  it("removes the files of every task the thirty days are over for", async () => {
    fake.answer = (text) =>
      text.startsWith('delete from "attachments"')
        ? [["projects/p/a1"], ["projects/p/a2"]]
        : text.startsWith('delete from "tasks"')
          ? [["t1"]]
          : [];
    expect(await sweepDeleted(PROJECT)).toBe(1);
    await settle();

    const files = fake.sql.findIndex((s) => s.startsWith('delete from "attachments"'));
    const tasks = fake.sql.findIndex((s) => s.startsWith('delete from "tasks"'));
    // The rows first, inside the transaction the tasks go in.
    expect(fake.sql[0]).toBe("begin");
    expect(files).toBeGreaterThan(0);
    expect(tasks).toBeGreaterThan(files);
    expect(fake.sql[files]).toContain('"deleted_at" is not null');
    expect(fake.sql.at(-1)).toBe("commit");
    expect(fake.removed.sort()).toEqual(["projects/p/a1", "projects/p/a2"]);
  });

  it("removes every file of a project that is deleted", async () => {
    fake.answer = (text) =>
      text.startsWith('delete from "attachments"') ? [[`projects/${PROJECT}/${ID}`]] : [];
    const res = await projectRoute.DELETE(
      new Request(`http://x/api/projects/${PROJECT}`, { method: "DELETE" }),
      { params: Promise.resolve({ projectId: PROJECT }) },
    );
    expect(res.status).toBe(200);
    await settle();
    const files = fake.sql.findIndex((s) => s.startsWith('delete from "attachments"'));
    const project = fake.sql.findIndex((s) => s.startsWith('delete from "projects"'));
    expect(files).toBeGreaterThan(-1);
    expect(project).toBeGreaterThan(files);
    expect(fake.removed).toEqual([`projects/${PROJECT}/${ID}`]);
  });
});

describe("the bucket never holds a read", () => {
  it("answers before a slow bucket removes anything, and asks for every object at once", async () => {
    let release = () => {};
    fake.hold = new Promise((done) => (release = done));
    fake.answer = (text) => (text.startsWith('delete from "attachments"') ? [["a"], ["b"]] : []);
    await sweepUnready({ projectId: PROJECT });
    expect(fake.removed).toEqual([]);
    release();
    await settle();
    expect(fake.removed.sort()).toEqual(["a", "b"]);
  });

  it("does nothing with no bucket", async () => {
    vi.stubEnv("S3_BUCKET", "");
    removeObjects(["a"]);
    await sweepUnready({ projectId: PROJECT });
    await settle();
    expect(fake.removed).toEqual([]);
    expect(fake.sql).toEqual([]);
  });
});

describe("a file on a task in the drawer", () => {
  it("is not found, as its task is not", async () => {
    expect(await attachmentRow(ID)).toBeNull();
    expect(fake.sql[0]).toContain('inner join "tasks"');
    expect(fake.sql[0]).toContain('"tasks"."deleted_at" is null');
  });
});

describe("the feed kind", () => {
  it("is one a webhook can ring for", () => {
    expect(readKinds(["attachment"])).toEqual(["attachment"]);
  });
});
