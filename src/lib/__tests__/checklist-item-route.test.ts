import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The checklist item route read as an agent or a person reads it: a reword
 * and a removal each leave one feed line that names the words. The database
 * writes nothing; it answers with the rows a test hands it.
 */
const fake = vi.hoisted(() => {
  type Rows = Record<string, unknown>[];
  const state = {
    caller: { id: "agent", kind: "agent" } as { id: string; kind: string },
    before: [] as Rows,
    updated: [] as Rows,
    deleted: [] as Rows,
  };
  const chain = (rows: () => Rows) => {
    const node: Record<string, unknown> = {};
    for (const step of ["returning", "from", "limit", "where", "set", "for"])
      node[step] = () => node;
    node.then = (ok: (rows: Rows) => unknown, fail?: (error: unknown) => unknown) =>
      Promise.resolve(rows()).then(ok, fail);
    return node;
  };
  const db = {
    select: () => chain(() => state.before),
    update: () => chain(() => state.updated),
    delete: () => chain(() => state.deleted),
    transaction: <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(db),
  };
  return { state, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("@/lib/queries", () => ({
  checklistTaskId: async () => "task-1",
  taskProjectId: async () => "project-1",
  logActivity: vi.fn(async () => undefined),
  touchTasks: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  guard: async () => ({ user: fake.state.caller, membership: { role: "member" } }),
  broadcast: vi.fn(async () => undefined),
}));

import { DELETE, PATCH } from "@/app/api/checklist/[itemId]/route";
import { logActivity } from "@/lib/queries";

const ITEM = "00000000-0000-4000-8000-000000000001";
const ctx = { params: Promise.resolve({ itemId: ITEM }) };

function patch(payload: unknown) {
  const req = new Request("http://localhost/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return PATCH(req, ctx);
}

const remove = () => DELETE(new Request("http://localhost/api", { method: "DELETE" }), ctx);

beforeEach(() => {
  fake.state.caller = { id: "agent", kind: "agent" };
  fake.state.before = [];
  fake.state.updated = [];
  fake.state.deleted = [];
  vi.mocked(logActivity).mockClear();
});

describe("DELETE /api/checklist/{id}", () => {
  for (const kind of ["agent", "human"]) {
    it(`writes a removed line with the item's words, for a ${kind}`, async () => {
      fake.state.caller = { id: kind, kind };
      fake.state.deleted = [{ text: "Retries stop after five tries" }];
      expect((await remove()).status).toBe(200);
      expect(logActivity).toHaveBeenCalledTimes(1);
      expect(logActivity).toHaveBeenCalledWith({
        projectId: "project-1",
        taskId: "task-1",
        actorId: kind,
        kind: "checklist",
        data: { text: "Retries stop after five tries", action: "removed" },
      });
    });
  }

  it("writes nothing when the item was already gone", async () => {
    expect((await remove()).status).toBe(200);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/checklist/{id} with new words", () => {
  it("writes a renamed line with the old and the new words", async () => {
    fake.state.before = [{ text: "Retries work" }];
    fake.state.updated = [{ id: ITEM, text: "A failed send retries five times", done: false }];
    const res = await patch({
      text: "A failed send retries five times",
      baseText: "Retries work",
    });
    expect(res.status).toBe(200);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "agent",
        kind: "checklist",
        data: {
          text: "A failed send retries five times",
          from: "Retries work",
          action: "renamed",
        },
      }),
    );
  });

  it("writes no line when the words did not change", async () => {
    fake.state.before = [{ text: "Same" }];
    fake.state.updated = [{ id: ITEM, text: "Same", done: false }];
    expect((await patch({ text: "Same" })).status).toBe(200);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("answers 409 with the current words and writes no line when a person edited meanwhile", async () => {
    fake.state.before = [{ text: "Edited by a person" }];
    const res = await patch({ text: "Mine", baseText: "Retries work" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ current: "Edited by a person" });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("keeps a tick's line as it was", async () => {
    fake.state.before = [{ text: "Ship it" }];
    fake.state.updated = [{ id: ITEM, text: "Ship it", done: true }];
    expect((await patch({ done: true })).status).toBe(200);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logActivity).mock.calls[0][0].data).toEqual({
      text: "Ship it",
      action: "checked",
    });
  });
});
