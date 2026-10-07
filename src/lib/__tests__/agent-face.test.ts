import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An owner or an admin changes the colour and the emoji of an agent. The
 * route is read as a client reads it; the database answers the member lookup
 * and remembers what the update set.
 */
const fake = vi.hoisted(() => {
  const state = {
    /** Who calls: a person with a role, or an agent's token. */
    caller: { kind: "human", role: "owner" },
    /** What the member lookup finds; null is a member outside the project. */
    member: { id: "agent-1", kind: "agent" } as { id: string; kind: string } | null,
    set: [] as Record<string, unknown>[],
    broadcasts: [] as unknown[],
  };
  const select: Record<string, unknown> = {};
  for (const name of ["from", "innerJoin", "where", "limit"]) select[name] = () => select;
  select.then = (ok: (rows: unknown[]) => unknown) =>
    Promise.resolve(state.member ? [state.member] : []).then(ok);
  const update: Record<string, unknown> = {};
  update.set = (patch: Record<string, unknown>) => {
    state.set.push(patch);
    return update;
  };
  update.where = () => update;
  update.returning = () =>
    Promise.resolve([
      {
        id: "agent-1",
        name: "Builder",
        color: (state.set.at(-1)?.color as string | undefined) ?? "#6d5bd0",
        emoji: (state.set.at(-1)?.avatarEmoji as string | null | undefined) ?? null,
      },
    ]);
  const db: Record<string, unknown> = { select: () => select, update: () => update };
  /* The write runs under the project lock, which is one more statement. */
  db.transaction = (work: (tx: unknown) => unknown) => work({ ...db, execute: async () => [] });
  return { state, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    guard: vi.fn(async () => ({
      user: { id: "caller-1", name: "Ada", kind: fake.state.caller.kind },
      membership: { role: fake.state.caller.role },
    })),
    broadcast: vi.fn(async (event: unknown) => {
      fake.state.broadcasts.push(event);
    }),
  };
});

const { PATCH } = await import("@/app/api/projects/[projectId]/agents/[agentId]/route");
const { Avatar } = await import("@/components/ui/Avatar");

const PROJECT = "7f1d2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const AGENT = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

async function change(payload: unknown) {
  const req = new Request(`http://localhost/api/projects/${PROJECT}/agents/${AGENT}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const res = await PATCH(req, { params: Promise.resolve({ projectId: PROJECT, agentId: AGENT }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  fake.state.caller = { kind: "human", role: "owner" };
  fake.state.member = { id: AGENT, kind: "agent" };
  fake.state.set = [];
  fake.state.broadcasts = [];
});

describe("PATCH /api/projects/{id}/agents/{agentId}", () => {
  it("lets an owner and an admin change the colour and the emoji, and broadcasts it", async () => {
    for (const role of ["owner", "admin"]) {
      fake.state.caller = { kind: "human", role };
      const res = await change({ color: "#2F9E7A", emoji: "🦊" });
      expect(res.status).toBe(200);
      expect(fake.state.set.at(-1)).toEqual({ color: "#2f9e7a", avatarEmoji: "🦊" });
      expect(res.body.agent).toMatchObject({ color: "#2f9e7a", emoji: "🦊" });
    }
    expect(fake.state.broadcasts).toEqual([
      expect.objectContaining({ projectId: PROJECT, scope: "project" }),
      expect.objectContaining({ projectId: PROJECT, scope: "project" }),
    ]);
  });

  it("takes the colour alone, the emoji alone, and null to clear the emoji", async () => {
    expect((await change({ color: "#e0574d" })).status).toBe(200);
    expect(fake.state.set.at(-1)).toEqual({ color: "#e0574d" });
    expect((await change({ emoji: "👩‍💻" })).status).toBe(200);
    expect(fake.state.set.at(-1)).toEqual({ avatarEmoji: "👩‍💻" });
    const cleared = await change({ emoji: null });
    expect(cleared.status).toBe(200);
    expect(fake.state.set.at(-1)).toEqual({ avatarEmoji: null });
    expect(cleared.body.agent.emoji).toBeNull();
  });

  it("answers 403 to a member and to an agent token, and writes nothing", async () => {
    fake.state.caller = { kind: "human", role: "member" };
    expect((await change({ color: "#e0574d" })).status).toBe(403);
    fake.state.caller = { kind: "agent", role: "member" };
    expect((await change({ emoji: "🦊" })).status).toBe(403);
    expect(fake.state.set).toEqual([]);
    expect(fake.state.broadcasts).toEqual([]);
  });

  it("answers 404 for a member outside the project and 400 for a person", async () => {
    fake.state.member = null;
    expect((await change({ color: "#e0574d" })).status).toBe(404);
    fake.state.member = { id: AGENT, kind: "human" };
    expect((await change({ color: "#e0574d" })).status).toBe(400);
    expect(fake.state.set).toEqual([]);
  });

  it("answers 400 to a colour that is not an avatar colour", async () => {
    for (const color of ["#8b8f98", "#123456", "red", "", 7, null]) {
      expect((await change({ color })).status).toBe(400);
    }
    expect(fake.state.set).toEqual([]);
  });

  it("answers 400 to an emoji that is not one emoji", async () => {
    for (const emoji of ["ab", "🦊🐻", "", "A", 7, ["🦊"]]) {
      expect((await change({ emoji })).status).toBe(400);
    }
    expect(fake.state.set).toEqual([]);
  });
});

describe("the face of an agent", () => {
  const draw = (props: Parameters<typeof Avatar>[0]) =>
    renderToStaticMarkup(createElement(Avatar, props));

  it("draws ◆ and no badge when it has no emoji", () => {
    const html = draw({ name: "Builder", color: "#6d5bd0", kind: "agent" });
    expect(html).toContain("◆");
    expect(html).not.toContain("agent-badge");
  });

  it("draws the emoji with a ◆ badge on the lower right", () => {
    const html = draw({ name: "Builder", color: "#6d5bd0", emoji: "🦊", kind: "agent" });
    expect(html).toContain("🦊");
    expect(html).toMatch(/data-testid="agent-badge"[^>]*>◆</);
    expect(html).toMatch(/right:[^;"]+;bottom:|bottom:[^;"]+;right:/);
  });

  it("never draws the badge on a person, with an emoji or without", () => {
    for (const emoji of ["🦊", null]) {
      const html = draw({ name: "Ada Lovelace", color: "#6d5bd0", emoji });
      expect(html).not.toContain("agent-badge");
      expect(html).not.toContain("◆");
    }
  });
});
