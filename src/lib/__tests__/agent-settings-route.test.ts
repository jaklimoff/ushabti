import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const events = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/events", () => ({
  publish: async (event: Record<string, unknown>) => void events.push(event),
}));

const { agent, api, board, join, ok, person, project, task } = await import("@/test/route");

/*
 * What an admin may change about an agent and about the rules agents obey,
 * and what the board answers afterwards. Each test was the server's half of
 * a test of `e2e/agent-face.spec.ts`, `e2e/agent-rename.spec.ts` or
 * `e2e/agent-rules.spec.ts`, and carries its name; the screen's half is in
 * `PeoplePanel.test.tsx` and `ProjectPanel.test.tsx`.
 */

/** An owner, a member and an agent on one project. */
async function team(agentName: string) {
  const owner = await person("Olga Owner");
  const member = await person("Bob Member");
  const p = await project(owner);
  await join(p.id, member, "member");
  const bot = await agent(owner, p.id, agentName);
  return { owner, member, project: p, bot };
}

describe("The face of an agent", () => {
  it("an owner changes an agent's colour and emoji, a member cannot, and another board follows", async () => {
    const { owner, member, project: p, bot } = await team("Painter");
    const face = `/api/projects/${p.id}/agents/${bot.id}`;

    events.length = 0;
    await ok(api(owner).patch(face, { color: "#2f9e7a", emoji: "🦊" }));
    // Another board hears it on the stream, and reads the board again.
    expect(events).toContainEqual(expect.objectContaining({ projectId: p.id, scope: "project" }));
    const painter = (await board(member, p.id)).members.find(
      (m: { id: string }) => m.id === bot.id,
    );
    expect(painter).toMatchObject({ kind: "agent", color: "#2f9e7a", emoji: "🦊" });

    expect((await api(member).patch(face, { emoji: null })).status).toBe(403);
    expect((await bot.api.patch(face, { emoji: null })).status).toBe(403);

    // The comment it writes is signed by the agent, so the panel draws its face.
    const t = await task(owner, p.id, "Painted by an agent");
    await ok(bot.api.post(`/api/tasks/${t.id}/comments`, { body: "Painted it green." }));
    const { task: detail } = await ok(api(member).get(`/api/tasks/${t.id}`));
    expect(detail.comments[0].author).toMatchObject({ id: bot.id, kind: "agent", emoji: "🦊" });

    await ok(api(owner).patch(face, { emoji: null }));
    const plain = (await board(member, p.id)).members.find((m: { id: string }) => m.id === bot.id);
    expect(plain.emoji).toBeNull();
  });
});

describe("Renaming an agent", () => {
  it("an admin renames an agent, its history shows the new name, and a name is one agent's", async () => {
    const { owner, project: p, bot } = await team("Scout");
    const t = await task(owner, p.id, "Scouted ground");
    await ok(bot.api.post(`/api/tasks/${t.id}/run`, { goal: "Scout it", step: "Looking around" }));
    await ok(bot.api.post(`/api/tasks/${t.id}/comments`, { body: "Found the river." }));

    events.length = 0;
    await ok(api(owner).patch(`/api/projects/${p.id}/agents/${bot.id}`, { name: "  Ranger " }));
    // The watcher that started under the old name is told to read its name again.
    expect(events).toContainEqual(expect.objectContaining({ renamed: bot.id }));

    // Old history joins the name on read.
    expect((await board(owner, p.id)).runs[0].agent.name).toBe("Ranger");
    const { task: detail } = await ok(api(owner).get(`/api/tasks/${t.id}`));
    expect(detail.run.agent.name).toBe("Ranger");
    expect(detail.comments[0].author.name).toBe("Ranger");
    expect((await ok(bot.api.get("/api/agent/me"))).agent.name).toBe("Ranger");

    // Two agents cannot share a name, in any case.
    const { agent: helper } = await ok(
      api(owner).post(`/api/projects/${p.id}/agents`, { name: "Helper" }),
    );
    const rename = (who: typeof owner, id: string, name: string) =>
      api(who).patch(`/api/projects/${p.id}/agents/${id}`, { name });
    expect((await rename(owner, helper.id, "ranger")).status).toBe(409);
    expect((await api(owner).post(`/api/projects/${p.id}/agents`, { name: "Ranger" })).status).toBe(
      409,
    );
    // An agent may keep its own name in another case.
    expect((await rename(owner, bot.id, "RANGER")).status).toBe(200);
    for (const name of ["", "   ", "x".repeat(81)]) {
      expect((await rename(owner, helper.id, name)).status).toBe(400);
    }

    // An agent token cannot rename an agent, itself included.
    for (const target of [bot.id, helper.id]) {
      expect((await rename(bot, target, "Taken over")).status).toBe(403);
    }
  });
});

describe("Agent rules", () => {
  it("an admin writes them; the claim carries them, and step and beat do not", async () => {
    const { owner, member, project: p, bot } = await team("Ruled");
    const since = (await ok(api(owner).get(`/api/projects/${p.id}/activity`))).now;
    const rulesLines = async () =>
      (
        await ok(
          api(owner).get(
            `/api/projects/${p.id}/activity?after=${encodeURIComponent(since)}&limit=200`,
          ),
        )
      ).entries.filter((e: { kind: string }) => e.kind === "rules");

    const rules = "Review means the option Done.\nAsk a person before you estimate.";
    await ok(api(owner).patch(`/api/projects/${p.id}`, { agentRules: rules }));
    // One change, one line; a save that changed nothing, none.
    await ok(api(owner).patch(`/api/projects/${p.id}`, { agentRules: rules }));
    const lines = await rulesLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].data.text).toBe(rules);

    // A member and an agent are refused.
    const meddle = { agentRules: "Do as you like." };
    expect((await api(member).patch(`/api/projects/${p.id}`, meddle)).status).toBe(403);
    expect((await bot.api.patch(`/api/projects/${p.id}`, meddle)).status).toBe(403);
    expect(await rulesLines()).toHaveLength(1);

    // An agent reads them on the claim, and only there.
    const t = await task(owner, p.id, "Follow the rules");
    expect((await board(bot, p.id)).project.agentRules).toBeNull();
    const claim = await ok(bot.api.post(`/api/tasks/${t.id}/run`, { goal: "Build it" }));
    expect(claim.rules).toEqual({ text: rules, hash: lines[0].data.hash });

    for (const report of [{ step: "Working" }, { beat: true }]) {
      const answer = await ok(bot.api.patch(`/api/runs/${claim.run.id}`, report));
      expect(answer).not.toHaveProperty("rules");
      expect(JSON.stringify(answer)).not.toContain("Ask a person");
    }
  });
});
