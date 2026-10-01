import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A person turns the ask emails off, and on again, on their account page.
 * The route is read as a client reads it; the database remembers what the
 * update set.
 */
const fake = vi.hoisted(() => {
  const state = { set: [] as Record<string, unknown>[] };
  const node: Record<string, unknown> = {};
  node.set = (patch: Record<string, unknown>) => {
    state.set.push(patch);
    return node;
  };
  node.where = () => node;
  node.returning = () =>
    Promise.resolve([{ id: "me", name: "Ada", email: "ada@example.com", ...state.set.at(-1) }]);
  return { state, db: { update: () => node } };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireUser: async () => ({ id: "me", kind: "human" }),
}));

const { PATCH } = await import("@/app/api/auth/me/route");

function save(body: unknown) {
  const req = new Request("http://localhost/api/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, undefined);
}

beforeEach(() => {
  fake.state.set = [];
});

describe("the ask emails on the account page", () => {
  it("turn off, and on again", async () => {
    expect((await save({ askMail: false })).status).toBe(200);
    expect(fake.state.set.at(-1)).toEqual({ askMail: false });
    expect((await save({ askMail: true })).status).toBe(200);
    expect(fake.state.set.at(-1)).toEqual({ askMail: true });
  });

  it("refuse anything but true or false", async () => {
    const res = await save({ askMail: "no" });
    expect(res.status).toBe(400);
    expect(fake.state.set).toEqual([]);
  });

  it("are left alone by a save of the name", async () => {
    await save({ name: "Ada Lovelace" });
    expect(fake.state.set.at(-1)).not.toHaveProperty("askMail");
  });
});
