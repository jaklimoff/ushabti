import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));
/* Every event the stream publishes, so a test can say none was presence. */
const published: { kind?: string; userId?: string }[] = [];
vi.mock("@/lib/events", async (load) => {
  const real = await load<typeof import("@/lib/events")>();
  return {
    ...real,
    publish: async (event: Parameters<typeof real.publish>[0]) => {
      published.push(event as { kind?: string; userId?: string });
      await real.publish(event);
    },
  };
});

const { db } = await import("@/db");
const { agent, api, call, join, ok, person, project, task } = await import("@/test/route");

const REFUSED = "A personal token cannot do this. Sign in to do it.";

type Caller = Awaited<ReturnType<typeof person>>;

/** A personal token made on the account page, and the calls made with it. */
async function personal(who: Caller, name = "Laptop script", days: number | null = 90) {
  const made = await api(who).post("/api/auth/tokens", { name, days });
  expect(made.status).toBe(201);
  const { secret, token } = (await made.json()) as { secret: string; token: { id: string } };
  const caller = { id: who.id, name: who.name, headers: { authorization: `Bearer ${secret}` } };
  return { secret, tokenId: token.id, caller, api: api(caller) };
}

async function refused(answer: Promise<Response>) {
  const res = await answer;
  expect(res.status).toBe(403);
  expect(((await res.json()) as { error: string }).error).toBe(REFUSED);
}

describe("Personal tokens", () => {
  it("is shown once, kept as a digest, and listed with prefix, made, expires and last used", async () => {
    const me = await person("Mira");
    const made = await ok<{ secret: string; token: Record<string, unknown> }>(
      api(me).post("/api/auth/tokens", { name: "Deploy script" }),
    );
    expect(made.secret).toMatch(/^ushp_/);
    expect(made.token.prefix).toBe(made.secret.slice(0, 13));
    // 90 days is the default.
    const days = (Date.parse(made.token.expiresAt as string) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(90);

    const stored = await db.execute<{ hash: string }>(
      sql`select hash from personal_tokens where id = ${made.token.id}`,
    );
    expect(stored.rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0].hash).not.toContain(made.secret);

    const caller = {
      id: me.id,
      name: me.name,
      headers: { authorization: `Bearer ${made.secret}` },
    };
    await ok(api(caller).get("/api/auth/me"));

    const { tokens } = await ok<{ tokens: Record<string, unknown>[] }>(
      api(me).get("/api/auth/tokens"),
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ name: "Deploy script", prefix: made.token.prefix });
    expect(tokens[0].createdAt).toEqual(expect.any(String));
    expect(tokens[0].lastUsedAt).toEqual(expect.any(String));
    expect(JSON.stringify(tokens)).not.toContain(made.secret);

    const never = await ok<{ token: { expiresAt: string | null } }>(
      api(me).post("/api/auth/tokens", { name: "Forever", days: null }),
    );
    expect(never.token.expiresAt).toBeNull();
    expect((await api(me).post("/api/auth/tokens", { name: "Odd", days: 7 })).status).toBe(400);
  });

  it("is answered 401 within one request once it is revoked or expired", async () => {
    const me = await person("Ravi");
    const kept = await personal(me);
    await ok(kept.api.get("/api/projects"));
    await ok(api(me).del(`/api/auth/tokens/${kept.tokenId}`));
    const gone = await kept.api.get("/api/projects");
    expect(gone.status).toBe(401);
    expect(((await gone.json()) as { error: string }).error).toBe(
      "That token is not valid any more.",
    );

    const old = await personal(me, "Old script", 30);
    await ok(old.api.get("/api/auth/me"));
    await db.execute(
      sql`update personal_tokens set expires_at = now() - interval '1 second' where id = ${old.tokenId}`,
    );
    expect((await old.api.get("/api/auth/me")).status).toBe(401);
    const { tokens } = await ok<{ tokens: { id: string }[] }>(api(me).get("/api/auth/tokens"));
    expect(tokens.map((t) => t.id)).not.toContain(old.tokenId);
  });

  it("refuses a reset link and somebody else's revoke", async () => {
    const me = await person("Sol");
    const other = await person("Tam");
    const mine = await personal(me);
    const reset = { id: me.id, name: me.name, headers: { authorization: "Bearer ushr_abc" } };
    expect((await api(reset).get("/api/auth/me")).status).toBe(401);
    expect((await api(other).del(`/api/auth/tokens/${mine.tokenId}`)).status).toBe(404);
    await ok(mine.api.get("/api/auth/me"));
  });

  it("opens every project its person is in, with their role there, and no other", async () => {
    const me = await person("Ines");
    const owner = await person("Olu");
    const mine = await project(me);
    const theirs = await project(owner);
    const adminOf = await project(owner);
    const stranger = await project(owner);
    await join(theirs.id, me, "member");
    await join(adminOf.id, me, "admin");
    const token = await personal(me);

    const { projects } = await ok<{ projects: { id: string }[] }>(token.api.get("/api/projects"));
    expect(projects.map((p) => p.id).sort()).toEqual([mine.id, theirs.id, adminOf.id].sort());

    await ok(token.api.get(`/api/projects/${theirs.id}/board`));
    expect((await token.api.get(`/api/projects/${stranger.id}/board`)).status).toBe(404);

    // A member cannot change the project; an admin can.
    expect((await token.api.patch(`/api/projects/${theirs.id}`, { name: "No" })).status).toBe(403);
    await ok(token.api.patch(`/api/projects/${adminOf.id}`, { name: "Renamed by a script" }));
    // Export and import stay open: they are the person's own acts.
    expect((await token.api.get(`/api/projects/${adminOf.id}/export`)).status).toBe(200);

    const me2 = await ok<{ user: { id: string; kind: string }; via: string }>(
      token.api.get("/api/auth/me"),
    );
    expect(me2).toMatchObject({ user: { id: me.id, kind: "human" }, via: "token" });
    const session = await ok<{ via: string; token: null }>(api(me).get("/api/auth/me"));
    expect(session).toMatchObject({ via: "session", token: null });
  });

  it("is refused by everything that lets somebody else in", async () => {
    const owner = await person("Owner");
    const member = await person("Member");
    const admin = await person("Admin");
    const p = await project(owner);
    await join(p.id, member, "member");
    await join(p.id, admin, "admin");
    const bot = await agent(owner, p.id);
    const token = await personal(owner);
    const t = token.api;
    const base = `/api/projects/${p.id}`;

    await refused(t.post(`${base}/agents`, { name: "Sneaky" }));
    await refused(t.patch(`${base}/agents/${bot.id}`, { name: "Renamed" }));
    await refused(t.patch(`${base}/agents/${bot.id}`, { emoji: "🦊" }));
    await refused(t.del(`${base}/agents/${bot.id}`));
    await refused(t.post(`${base}/agents/${bot.id}/tokens`, { name: "More" }));
    await refused(t.del(`/api/agent-tokens/${bot.tokenId}`));
    await refused(t.post(`${base}/members`, { email: "new@example.com", role: "member" }));
    await refused(t.patch(`${base}/members/${member.id}`, { role: "admin" }));
    await refused(t.patch(`${base}/members/${admin.id}`, { role: "member" }));
    await refused(t.patch(`${base}/members/${admin.id}`, { role: "owner" }));
    await refused(t.del(`${base}/members/${member.id}`));
    await refused(t.post(`${base}/members/${member.id}/reset`, {}));
    await refused(t.del(`${base}/invites/${encodeURIComponent("new@example.com")}`));
    await refused(t.get(`${base}/webhooks`));
    await refused(t.post(`${base}/webhooks`, { url: "https://example.com/hook" }));
    const hook = await ok<{ webhook: { id: string } }>(
      api(owner).post(`${base}/webhooks`, { url: "https://example.com/hook" }),
    );
    await refused(t.patch(`${base}/webhooks/${hook.webhook.id}`, { active: false }));
    await refused(t.post(`${base}/webhooks/${hook.webhook.id}`, {}));
    await refused(t.del(`${base}/webhooks/${hook.webhook.id}`));
    await refused(t.get(`${base}/webhooks/${hook.webhook.id}/count`));
    await refused(t.del(base));
    await refused(t.patch(base, { publicChangelog: true }));
    await refused(t.patch(base, { agentRules: "Do whatever you like." }));
    await refused(t.patch("/api/auth/me", { emoji: "🦊" }));
    await refused(t.patch("/api/auth/me", { name: "Somebody else" }));
    await refused(t.post("/api/auth/tokens", { name: "Another" }));
    await refused(t.get("/api/auth/tokens"));
    await refused(t.del(`/api/auth/tokens/${token.tokenId}`));
    await refused(t.post("/api/projects", { name: "Made by a script" }));
    await refused(t.get("/api/auth/sessions"));
    await refused(t.post("/api/auth/password", { current: "x", next: "yyyyyyyy" }));

    // Nothing changed: the project, its people and its agent are all there.
    const board = await ok<{ members: { id: string }[] }>(api(owner).get(`${base}/board`));
    expect(board.members.map((m) => m.id)).toEqual(expect.arrayContaining([member.id, bot.id]));
  });

  it("may leave a project, as its person may", async () => {
    const owner = await person("Keeper");
    const me = await person("Leaver");
    const p = await project(owner);
    await join(p.id, me, "member");
    const token = await personal(me);
    await ok(token.api.del(`/api/projects/${p.id}/members/${me.id}`));
    expect((await token.api.get(`/api/projects/${p.id}/board`)).status).toBe(404);
    // Leaving every project keeps the account and its tokens.
    await ok(token.api.get("/api/auth/me"));
  });

  it("is refused by the agent's run routes and by presence, and says no goodbye", async () => {
    const owner = await person("Pia");
    const p = await project(owner);
    const t = await task(owner, p.id, "Run for an agent");
    const token = await personal(owner);

    const run = await token.api.post(`/api/tasks/${t.id}/run`, { goal: "Do it" });
    expect(run.status).toBe(403);
    expect(((await run.json()) as { error: string }).error).toBe("Only an agent can do this.");
    expect((await call(token.caller, "GET", "/api/agent/me")).status).toBe(403);

    const presence = await call(token.caller, "POST", `/api/projects/${p.id}/presence`, {
      taskId: t.id,
    });
    expect(presence.status).toBe(403);

    published.length = 0;
    const stream = await call(token.caller, "GET", `/api/projects/${p.id}/stream?client=tab-1`);
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((done) => setTimeout(done, 20));
    expect(published.filter((e) => e.kind === "presence")).toEqual([]);
    const { agents } = await ok<{ agents: { tokens: { listeningAt: string | null }[] }[] }>(
      api(owner).get(`/api/projects/${p.id}/agents`),
    );
    expect(agents.flatMap((a) => a.tokens).filter((x) => x.listeningAt)).toEqual([]);
  });

  it("signs every line and comment with the person, via the token, also once it is revoked", async () => {
    const owner = await person("Noor");
    const p = await project(owner);
    const bot = await agent(owner, p.id);
    const token = await personal(owner, "Release script");
    const made = await ok<{ task: { id: string } }>(
      token.api.post(`/api/projects/${p.id}/tasks`, { title: "Made by a script" }),
    );
    const posted = await ok<{ comment: { via: string | null } }>(
      token.api.post(`/api/tasks/${made.task.id}/comments`, { body: "Signed by Noor" }),
    );
    expect(posted.comment.via).toBe("Release script");
    // A line by the session carries no via.
    await ok(api(owner).post(`/api/tasks/${made.task.id}/comments`, { body: "By hand" }));

    // A run's control word is the person's own act, and is signed too.
    const started = await ok<{ run: { id: string } }>(
      bot.api.post(`/api/tasks/${made.task.id}/run`, { goal: "Work" }),
    );
    await ok(token.api.post(`/api/runs/${started.run.id}/control`, { control: "take_over" }));

    await ok(api(owner).del(`/api/auth/tokens/${token.tokenId}`));

    type Detail = {
      task: {
        comments: { body: string; via: string | null; author: { id: string } }[];
        activity: { kind: string; via: string | null; actor: { id: string } | null }[];
      };
    };
    const detail = await ok<Detail>(api(owner).get(`/api/tasks/${made.task.id}`));
    const signed = detail.task.comments.find((c) => c.body === "Signed by Noor")!;
    expect(signed).toMatchObject({ via: "Release script", author: { id: owner.id } });
    expect(detail.task.comments.find((c) => c.body === "By hand")!.via).toBeNull();
    const created = detail.task.activity.find((a) => a.kind === "created")!;
    expect(created).toMatchObject({ via: "Release script", actor: { id: owner.id } });
    const runLines = detail.task.activity.filter(
      (a) => a.kind === "run" && a.actor?.id === owner.id,
    );
    expect(runLines.length).toBeGreaterThan(0);
    expect(runLines.every((a) => a.via === "Release script")).toBe(true);

    const feed = await ok<{ entries: { kind: string; via: string | null }[] }>(
      bot.api.get(`/api/projects/${p.id}/activity?after=${new Date(0).toISOString()}`),
    );
    expect(feed.entries.find((e) => e.kind === "created")!.via).toBe("Release script");
  });
});
