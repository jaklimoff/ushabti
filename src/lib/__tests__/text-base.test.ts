import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two routes that write words are read here as an agent reads them: a
 * request goes in, an answer comes out. The database writes nothing. It
 * remembers the one condition each update carried, and answers the update and
 * the read that follows it with the rows a test hands it.
 */
const fake = vi.hoisted(() => {
  type Rows = Record<string, unknown>[];
  const state = {
    updated: [] as Rows,
    read: [] as Rows,
    where: [] as unknown[],
    updates: 0,
  };
  const chain = (rows: () => Rows) => {
    const node: Record<string, unknown> = {};
    for (const step of ["set", "returning", "from", "limit"]) node[step] = () => node;
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
  checklistTaskId: async () => "task-1",
  logActivity: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  guard: async () => ({ user: { id: "user-1", kind: "human" } }),
  broadcast: vi.fn(async () => undefined),
}));

import { PATCH as patchTask } from "@/app/api/tasks/[taskId]/route";
import { PATCH as patchItem } from "@/app/api/checklist/[itemId]/route";
import { broadcast } from "@/lib/api";
import { logActivity } from "@/lib/queries";

function send(payload: unknown) {
  return new Request("http://localhost/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const task = (payload: unknown) =>
  patchTask(send(payload), { params: Promise.resolve({ taskId: "task-1" }) });
const item = (payload: unknown) =>
  patchItem(send(payload), { params: Promise.resolve({ itemId: "item-1" }) });

/** The condition of the one update, as Postgres would read it. */
function condition() {
  expect(fake.state.where.length).toBeGreaterThan(0);
  return new PgDialect().sqlToQuery(fake.state.where[0] as SQL);
}

beforeEach(() => {
  fake.state.updated = [];
  fake.state.read = [];
  fake.state.where = [];
  fake.state.updates = 0;
  vi.mocked(logActivity).mockClear();
  vi.mocked(broadcast).mockClear();
});

describe("PATCH /api/tasks/{id}", () => {
  it("writes without a base as it always did, and compares nothing", async () => {
    fake.state.updated = [{ id: "task-1" }];
    const res = await task({ description: "New words" });
    expect(res.status).toBe(200);
    expect(condition().params).toEqual(["task-1"]);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("puts the base in the same statement as the update", async () => {
    fake.state.updated = [{ id: "task-1" }];
    const res = await task({ description: "Mine", baseDescription: "Before" });
    expect(res.status).toBe(200);
    expect(fake.state.updates).toBe(1);
    const { sql, params } = condition();
    expect(sql).toContain('"description"');
    expect(params).toEqual(["task-1", "Before", "Mine"]);
  });

  it("answers 409 with the saved text when the description changed, and writes no line", async () => {
    fake.state.updated = [];
    fake.state.read = [{ title: "A task", description: "Theirs" }];
    const res = await task({ description: "Mine", baseDescription: "Before" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "This changed while you typed.",
      field: "description",
      current: "Theirs",
    });
    expect(logActivity).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("answers 409 for the title in the same way", async () => {
    fake.state.read = [{ title: "Their title", description: "" }];
    const res = await task({ title: "My title", baseTitle: "Old title" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ field: "title", current: "Their title" });
    expect(condition().params).toEqual(["task-1", "Old title", "My title"]);
  });

  it("compares the trimmed title it will write, so the same words are not a clash", async () => {
    fake.state.updated = [{ id: "task-1" }];
    await task({ title: "  Same  ", baseTitle: "Old" });
    expect(condition().params).toEqual(["task-1", "Old", "Same"]);
  });

  it("ignores a base for a field it does not write", async () => {
    fake.state.updated = [{ id: "task-1" }];
    const res = await task({ title: "New", baseDescription: "Anything" });
    expect(res.status).toBe(200);
    expect(condition().params).toEqual(["task-1"]);
  });

  it("refuses a base that is not text", async () => {
    const res = await task({ description: "Mine", baseDescription: 4 });
    expect(res.status).toBe(400);
    expect(fake.state.updates).toBe(0);
  });

  it("answers 404 when the task went away under the write", async () => {
    const res = await task({ description: "Mine", baseDescription: "Before" });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/checklist/{id}", () => {
  const saved = { id: "item-1", taskId: "task-1", text: "Mine", done: false };

  it("writes without a base as it always did", async () => {
    fake.state.updated = [saved];
    const res = await item({ text: "Mine" });
    expect(res.status).toBe(200);
    expect(condition().params).toEqual(["item-1"]);
  });

  it("puts the base in the same statement as the update", async () => {
    fake.state.updated = [saved];
    const res = await item({ text: "Mine", baseText: "Before" });
    expect(res.status).toBe(200);
    expect(fake.state.updates).toBe(1);
    expect(condition().params).toEqual(["item-1", "Before", "Mine"]);
  });

  it("answers 409 with the saved words when they changed", async () => {
    fake.state.read = [{ text: "Theirs" }];
    const res = await item({ text: "Mine", baseText: "Before" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ current: "Theirs" });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("never lets a tick be refused by a base", async () => {
    fake.state.updated = [{ ...saved, done: true }];
    const res = await item({ done: true, baseText: "Before" });
    expect(res.status).toBe(200);
    expect(condition().params).toEqual(["item-1"]);
  });
});
