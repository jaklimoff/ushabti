import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The comment route read as an agent reads it: a request goes in, an answer
 * comes out. The database writes nothing. It remembers what each update set
 * and on what condition, and answers with the rows a test hands it.
 */
const fake = vi.hoisted(() => {
  type Rows = Record<string, unknown>[];
  const state = {
    comment: null as Record<string, unknown> | null,
    caller: { id: "author", kind: "human" } as { id: string; kind: string },
    role: "member",
    updated: [] as Rows,
    read: [] as Rows,
    where: [] as unknown[],
    set: [] as Record<string, unknown>[],
    updates: 0,
  };
  const chain = (rows: () => Rows) => {
    const node: Record<string, unknown> = {};
    for (const step of ["returning", "from", "limit"]) node[step] = () => node;
    node.set = (patch: Record<string, unknown>) => {
      state.set.push(patch);
      return node;
    };
    node.where = (condition: unknown) => {
      state.where.push(condition);
      return node;
    };
    node.then = (ok: (rows: Rows) => unknown, fail?: (error: unknown) => unknown) =>
      Promise.resolve(rows()).then(ok, fail);
    return node;
  };
  const db = {
    update: () => {
      state.updates += 1;
      return chain(() => state.updated);
    },
    select: () => chain(() => state.read),
  };
  return { state, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("@/lib/queries", () => ({
  taskProjectId: async () => "project-1",
  commentRow: async () => fake.state.comment,
  logActivity: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  guard: async () => ({ user: fake.state.caller, membership: { role: fake.state.role } }),
  broadcast: vi.fn(async () => undefined),
}));

import { PATCH } from "@/app/api/comments/[commentId]/route";
import { broadcast } from "@/lib/api";
import { logActivity } from "@/lib/queries";

const COMMENT = "00000000-0000-4000-8000-000000000001";

function edit(payload: unknown) {
  const req = new Request("http://localhost/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return PATCH(req, { params: Promise.resolve({ commentId: COMMENT }) });
}

/** The condition of the one update, as Postgres would read it. */
function condition() {
  expect(fake.state.where.length).toBeGreaterThan(0);
  return new PgDialect().sqlToQuery(fake.state.where[0] as SQL);
}

beforeEach(() => {
  fake.state.comment = { id: COMMENT, taskId: "task-1", authorId: "author", body: "Before" };
  fake.state.caller = { id: "author", kind: "human" };
  fake.state.role = "member";
  fake.state.updated = [];
  fake.state.read = [];
  fake.state.where = [];
  fake.state.set = [];
  fake.state.updates = 0;
  vi.mocked(logActivity).mockClear();
  vi.mocked(broadcast).mockClear();
});

describe("PATCH /api/comments/{id}", () => {
  it("writes the author's new words, marks the edit, logs one line and broadcasts", async () => {
    fake.state.updated = [{ id: COMMENT }];
    const res = await edit({ body: "  After  " });
    expect(res.status).toBe(200);
    expect(fake.state.updates).toBe(1);
    expect(fake.state.set[0].body).toBe("After");
    expect(fake.state.set[0].editedAt).toBeInstanceOf(Date);
    expect(fake.state.set[0]).not.toHaveProperty("createdAt");
    expect(condition().params).toEqual([COMMENT]);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        actorId: "author",
        kind: "comment",
        data: { commentId: COMMENT, action: "edited" },
      }),
    );
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "task", taskId: "task-1" }),
    );
  });

  it("lets an agent edit its own comment", async () => {
    fake.state.comment!.authorId = "agent";
    fake.state.caller = { id: "agent", kind: "agent" };
    fake.state.updated = [{ id: COMMENT }];
    const res = await edit({ body: "After" });
    expect(res.status).toBe(200);
  });

  it.each(["member", "admin", "owner"])(
    "refuses a %s who is not the author, and writes nothing",
    async (role) => {
      fake.state.caller = { id: "somebody", kind: "human" };
      fake.state.role = role;
      const res = await edit({ body: "Their words" });
      expect(res.status).toBe(403);
      expect(fake.state.updates).toBe(0);
      expect(logActivity).not.toHaveBeenCalled();
    },
  );

  it("refuses a comment whose author is gone", async () => {
    fake.state.comment!.authorId = null;
    const res = await edit({ body: "After" });
    expect(res.status).toBe(403);
  });

  it("refuses an empty body and says to delete the comment instead", async () => {
    const res = await edit({ body: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/delete/i);
    expect(fake.state.updates).toBe(0);
  });

  it("refuses a body over 8000 characters", async () => {
    const res = await edit({ body: "x".repeat(8001) });
    expect(res.status).toBe(400);
    expect(fake.state.updates).toBe(0);
  });

  it("writes nothing when the words are the same", async () => {
    const res = await edit({ body: " Before ", baseBody: "Older" });
    expect(res.status).toBe(200);
    expect(fake.state.updates).toBe(0);
    expect(logActivity).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("puts the base in the same statement as the update", async () => {
    fake.state.updated = [{ id: COMMENT }];
    const res = await edit({ body: "Mine", baseBody: "Before" });
    expect(res.status).toBe(200);
    expect(fake.state.updates).toBe(1);
    expect(condition().params).toEqual([COMMENT, "Before", "Mine"]);
  });

  it("answers 409 with the saved words when a newer save came first, and writes no line", async () => {
    fake.state.updated = [];
    fake.state.read = [{ body: "Theirs" }];
    const res = await edit({ body: "Mine", baseBody: "Before" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "This changed while you typed.",
      field: "body",
      current: "Theirs",
    });
    expect(logActivity).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("answers 404 when the comment went away under the write", async () => {
    const res = await edit({ body: "Mine", baseBody: "Before" });
    expect(res.status).toBe(404);
  });

  it("answers 404 for a comment that does not exist", async () => {
    fake.state.comment = null;
    const res = await edit({ body: "Mine" });
    expect(res.status).toBe(404);
  });
});
