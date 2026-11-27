import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
/* The test database, with the table of every select written down, so a test
   can say the invites were never read. */
const tables = vi.hoisted(() => ({ read: [] as string[] }));
vi.mock("@/db", async () => {
  const real = await import("@/test/db");
  const { getTableName, Table } = await import("drizzle-orm");
  const db = new Proxy(real.db, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key !== "select" && key !== "selectDistinct") return value;
      return (...args: unknown[]) => {
        const builder = (value as (...a: unknown[]) => { from: (t: unknown) => unknown })(...args);
        const from = builder.from.bind(builder);
        builder.from = (table: unknown) => {
          if (table instanceof Table) tables.read.push(getTableName(table));
          return from(table);
        };
        return builder;
      };
    },
  });
  return { ...real, db };
});
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, join, ok, person, project } = await import("@/test/route");

/*
 * What an agent's token reads of the people on a board. It names them, so a
 * person value still resolves, and hands out no email and no invite: a token
 * that leaks must not leak who is on the board or who is asked to join it.
 */

type Read = { members: { id: string; email: string | null }[]; invites: unknown[] };

/** A board with an owner, a member, an invite and an agent. */
async function staffed() {
  const owner = await person("Reads Owner");
  const p = await project(owner);
  const mate = await person("Reads Mate");
  await join(p.id, mate, "member");
  await ok(api(owner).post(`/api/projects/${p.id}/members`, { email: "asked@example.com" }));
  const bot = await agent(owner, p.id);
  const made = await ok<{ secret: string }>(
    api(owner).post("/api/auth/tokens", { name: "Laptop", days: 90 }),
  );
  const mine = api({
    id: owner.id,
    name: owner.name,
    headers: { authorization: `Bearer ${made.secret}` },
  });
  return { owner, mate, p, bot, mine };
}

const paths = (id: string) => [`/api/projects/${id}/board`, `/api/projects/${id}/settings`];

describe("What an agent reads of the people", () => {
  it("names every member with no email, and no invite", async () => {
    const { owner, mate, p, bot } = await staffed();
    for (const path of paths(p.id)) {
      const read = await ok<Read>(bot.api.get(path));
      expect(read.members.map((m) => m.id)).toEqual(
        expect.arrayContaining([owner.id, mate.id, bot.id]),
      );
      expect(read.members.every((m) => m.email === null)).toBe(true);
      expect(read.invites).toEqual([]);
    }
  });

  it("does not read the invites at all", async () => {
    const { p, bot } = await staffed();
    for (const path of paths(p.id)) {
      tables.read = [];
      await ok(bot.api.get(path));
      expect(tables.read).toContain("tasks");
      expect(tables.read).not.toContain("project_invites");
    }
  });

  it("is unchanged for a session and for a personal token", async () => {
    const { owner, p, mine } = await staffed();
    for (const as of [api(owner), mine]) {
      for (const path of paths(p.id)) {
        tables.read = [];
        const read = await ok<Read>(as.get(path));
        const me = read.members.find((m) => m.id === owner.id)!;
        expect(me.email).toMatch(/@example\.com$/);
        expect(read.invites).toEqual([expect.objectContaining({ email: "asked@example.com" })]);
        expect(tables.read).toContain("project_invites");
      }
    }
  });

  it("gives an agent no email from a view's tasks", async () => {
    const { p, bot } = await staffed();
    const { views } = await ok<{ views: { id: string }[] }>(
      bot.api.get(`/api/projects/${p.id}/board`),
    );
    const res = await bot.api.get(`/api/views/${views[0].id}/tasks`);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("@example.com");
  });

  it("lists the agents for a person and refuses an agent", async () => {
    const { owner, p, bot } = await staffed();
    const refused = await bot.api.get(`/api/projects/${p.id}/agents`);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe("Only a person can do this.");
    const listed = await ok<{ agents: { id: string }[] }>(
      api(owner).get(`/api/projects/${p.id}/agents`),
    );
    expect(listed.agents.map((a) => a.id)).toContain(bot.id);
  });
});
