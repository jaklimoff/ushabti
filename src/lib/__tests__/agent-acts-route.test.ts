import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { and, eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { projectMembers } = await import("@/db/schema");
const { agent, api, board, join, ok, person, project, task } = await import("@/test/route");
const { AGENT_ACTS, readAgentActs } = await import("@/lib/roles");

/*
 * The switches an admin turns off for one agent on one board. Every act is
 * walked through every route behind it: off, the route refuses and names the
 * agent and the act; on, the agent passes.
 */

type Caller = Awaited<ReturnType<typeof person>>;
type Act = (typeof AGENT_ACTS)[number];
type Board = {
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  views: { id: string }[];
};

const WORDS: Record<Act, string> = {
  create: "create tasks",
  delete: "delete tasks",
  archive: "archive tasks",
  checklist: "edit checklists",
  structure: "change the structure",
  ship: "ship releases",
};

async function team() {
  const owner = await person("Olga Owner");
  const p = await project(owner);
  const bot = await agent(owner, p.id, "Switched");
  return { owner, p, bot };
}

function setActs(who: Caller, projectId: string, agentId: string, acts: Record<string, unknown>) {
  return api(who).patch(`/api/projects/${projectId}/agents/${agentId}`, { acts });
}

/** Every act on, but the ones named. */
function only(off: Act[]): Record<Act, boolean> {
  return Object.fromEntries(AGENT_ACTS.map((act) => [act, !off.includes(act)])) as Record<
    Act,
    boolean
  >;
}

async function refused(answer: Promise<Response>, name: string, act: Act) {
  const res = await answer;
  expect(res.status).toBe(403);
  expect(((await res.json()) as { error: string }).error).toBe(
    `This project does not let ${name} ${WORDS[act]}.`,
  );
}

async function passed(answer: Promise<Response>) {
  const res = await answer;
  if (res.status >= 300) throw new Error(`${res.status}: ${await res.text()}`);
}

/** A select with one dated option that is due, and one task in it that is over. */
async function dueRelease(owner: Caller, projectId: string) {
  const me = api(owner);
  const name = `Version ${Math.random().toString(36).slice(2, 7)}`;
  await ok(
    me.post(`/api/projects/${projectId}/properties`, {
      name,
      type: "select",
      options: ["v1", "v2"],
    }),
  );
  const read = (await board(owner, projectId)) as Board;
  const version = read.properties.find((x) => x.name === name)!;
  await ok(me.patch(`/api/properties/${version.id}`, { dated: true }));
  await ok(me.patch(`/api/options/${version.options[0].id}`, { targetAt: "2026-10-14" }));
  return version.options[0].id;
}

/**
 * The calls behind each act. Each one readies what it needs as the owner and
 * then calls as `who`, so it can run again on a fresh task.
 */
function callsOf(owner: Caller, projectId: string) {
  const me = api(owner);
  const fresh = () => task(owner, projectId, "Something to act on");
  const item = async () => {
    const t = await fresh();
    const { item } = await ok(me.post(`/api/tasks/${t.id}/checklist`, { text: "Check it" }));
    return item.id as string;
  };
  const read = async () => (await board(owner, projectId)) as Board;
  /* Held by id: a call below renames it. */
  let statusId: string | null = null;
  const status = async () => {
    const { properties } = await read();
    statusId ??= properties.find((x) => x.name === "Status")!.id;
    return properties.find((x) => x.id === statusId)!;
  };
  type Call = (who: Caller) => Promise<Response>;
  const calls: Record<Act, Record<string, Call>> = {
    create: {
      "POST tasks": (who) => api(who).post(`/api/projects/${projectId}/tasks`, { title: "Made" }),
    },
    delete: {
      "DELETE task": async (who) => api(who).del(`/api/tasks/${(await fresh()).id}`),
      "POST restore": async (who) => {
        const t = await fresh();
        await ok(me.del(`/api/tasks/${t.id}`));
        return api(who).post(`/api/tasks/${t.id}/restore`, {});
      },
    },
    archive: {
      "POST archive": async (who) => api(who).post(`/api/tasks/${(await fresh()).id}/archive`, {}),
      "DELETE archive": async (who) => {
        const t = await fresh();
        await ok(me.post(`/api/tasks/${t.id}/archive`, {}));
        return api(who).del(`/api/tasks/${t.id}/archive`);
      },
    },
    checklist: {
      "PATCH item text": async (who) =>
        api(who).patch(`/api/checklist/${await item()}`, { text: "Reworded" }),
      "DELETE item": async (who) => api(who).del(`/api/checklist/${await item()}`),
    },
    structure: {
      "POST property": (who) =>
        api(who).post(`/api/projects/${projectId}/properties`, {
          name: `Area ${Math.random().toString(36).slice(2, 7)}`,
          type: "text",
        }),
      "POST option": async (who) =>
        api(who).post(`/api/properties/${(await status()).id}/options`, {
          name: `Opt ${Math.random().toString(36).slice(2, 7)}`,
        }),
      "POST view": (who) =>
        api(who).post(`/api/projects/${projectId}/views`, {
          name: `View ${Math.random().toString(36).slice(2, 7)}`,
          kind: "list",
        }),
      "PATCH option name": async (who) =>
        api(who).patch(`/api/options/${(await status()).options[0].id}`, {
          name: `Renamed ${Math.random().toString(36).slice(2, 7)}`,
        }),
      /* What a roadmap bar's end writes when it is dragged. */
      "PATCH option target": async (who) =>
        api(who).patch(`/api/options/${(await status()).options[0].id}`, {
          targetAt: "2027-01-15",
        }),
      "PATCH option colour": async (who) =>
        api(who).patch(`/api/options/${(await status()).options[0].id}`, { color: "#2f9e7a" }),
      "PATCH option place": async (who) => {
        const { options } = await status();
        return api(who).patch(`/api/options/${options[0].id}`, { afterId: options[1].id });
      },
      "PATCH property name": async (who) =>
        api(who).patch(`/api/properties/${(await status()).id}`, {
          name: `Stage ${Math.random().toString(36).slice(2, 7)}`,
        }),
      "PATCH view group": async (who) =>
        api(who).patch(`/api/views/${(await read()).views[0].id}`, {
          groupById: (await status()).id,
        }),
      "PATCH view sort": async (who) =>
        api(who).patch(`/api/views/${(await read()).views[0].id}`, {
          sort: { columnId: "_title", direction: "asc" },
        }),
    },
    ship: {
      "POST ship": async (who) =>
        api(who).post(`/api/options/${await dueRelease(owner, projectId)}/ship`, { rest: "leave" }),
    },
  };
  return calls;
}

describe("An agent's switches", () => {
  it("each route behind an act refuses with the act off and lets the agent through with it on", async () => {
    const { owner, p, bot } = await team();
    const calls = callsOf(owner, p.id);
    for (const act of AGENT_ACTS) {
      await ok(setActs(owner, p.id, bot.id, only([act])));
      for (const call of Object.values(calls[act])) await refused(call(bot), "Switched", act);
      await ok(setActs(owner, p.id, bot.id, only([])));
      for (const call of Object.values(calls[act])) await passed(call(bot));
    }
  });

  it("Delete starts off and the rest start on, for a new agent, with nothing stored", async () => {
    const { owner, p, bot } = await team();
    const [row] = await db
      .select({ acts: projectMembers.acts })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, bot.id)));
    expect(row.acts).toEqual({});
    const calls = callsOf(owner, p.id);
    for (const call of Object.values(calls.delete)) await refused(call(bot), "Switched", "delete");
    for (const act of AGENT_ACTS.filter((a) => a !== "delete" && a !== "ship")) {
      for (const call of Object.values(calls[act])) await passed(call(bot));
    }
    await passed(calls.ship["POST ship"](bot));
    const me = await ok(bot.api.get("/api/agent/me"));
    expect(me.project.off).toEqual([{ act: "delete", words: "delete tasks" }]);
  });

  it("the board an agent reads says whether it may change the structure", async () => {
    const { owner, p, bot } = await team();
    const read = async (who: Caller) =>
      (
        (await ok(api(who).get(`/api/projects/${p.id}/board`))) as {
          project: { mayStructure: boolean };
        }
      ).project.mayStructure;
    expect(await read(bot)).toBe(true);
    await ok(setActs(owner, p.id, bot.id, only(["structure"])));
    expect(await read(bot)).toBe(false);
    // A person always may, so a roadmap bar drags for them.
    expect(await read(owner)).toBe(true);
  });

  it("a ship asks Ship releases and Archive tasks both", async () => {
    const { owner, p, bot } = await team();
    const ship = callsOf(owner, p.id).ship["POST ship"];
    await ok(setActs(owner, p.id, bot.id, only(["ship"])));
    await refused(ship(bot), "Switched", "ship");
    await ok(setActs(owner, p.id, bot.id, only(["archive"])));
    await refused(ship(bot), "Switched", "archive");
    await ok(setActs(owner, p.id, bot.id, only([])));
    await passed(ship(bot));
  });

  it("with Edit checklists off, an agent adds and ticks an item but cannot reword or remove one", async () => {
    const { owner, p, bot } = await team();
    await ok(setActs(owner, p.id, bot.id, { checklist: false }));
    const t = await task(owner, p.id, "A list to keep");
    const { item } = await ok(bot.api.post(`/api/tasks/${t.id}/checklist`, { text: "Mine" }));
    await ok(bot.api.patch(`/api/checklist/${item.id}`, { done: true }));
    await refused(
      bot.api.patch(`/api/checklist/${item.id}`, { text: "Other" }),
      "Switched",
      "checklist",
    );
    await refused(
      bot.api.patch(`/api/checklist/${item.id}`, { text: "Other", done: false }),
      "Switched",
      "checklist",
    );
    await refused(bot.api.del(`/api/checklist/${item.id}`), "Switched", "checklist");
    const { task: detail } = await ok(api(owner).get(`/api/tasks/${t.id}`));
    expect(detail.checklist).toEqual([expect.objectContaining({ text: "Mine", done: true })]);
  });

  it("two agents on one board keep their own switches", async () => {
    const { owner, p, bot } = await team();
    const other = await agent(owner, p.id, "Other");
    await ok(setActs(owner, p.id, bot.id, { create: false }));
    await ok(setActs(owner, p.id, other.id, { delete: true }));
    const make = (who: Caller) => api(who).post(`/api/projects/${p.id}/tasks`, { title: "New" });
    await refused(make(bot), "Switched", "create");
    await passed(make(other));
    const t = await task(owner, p.id, "Gone soon");
    await refused(bot.api.del(`/api/tasks/${t.id}`), "Switched", "delete");
    await passed(other.api.del(`/api/tasks/${t.id}`));

    // The same agent on another board is not touched by these.
    const { agents } = await ok(api(owner).get(`/api/projects/${p.id}/agents`));
    const acts = Object.fromEntries(
      agents.map((a: { name: string; acts: unknown }) => [a.name, a.acts]),
    );
    expect(acts).toEqual({ Switched: { create: false }, Other: { delete: true } });
  });

  it("a person, with a session or a personal token, is never refused by a switch", async () => {
    const { owner, p, bot } = await team();
    const member = await person("Mia Member");
    await join(p.id, member, "member");
    await ok(setActs(owner, p.id, bot.id, only([...AGENT_ACTS])));
    // A person's own row carrying switches still refuses nothing.
    await db
      .update(projectMembers)
      .set({ acts: only([...AGENT_ACTS]) })
      .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, member.id)));
    const made = await api(member).post("/api/auth/tokens", { name: "Script", days: 90 });
    expect(made.status).toBe(201);
    const { secret } = (await made.json()) as { secret: string };
    const viaToken = { ...member, headers: { authorization: `Bearer ${secret}` } };

    const calls = callsOf(owner, p.id);
    for (const who of [owner, member, viaToken]) {
      for (const act of AGENT_ACTS) {
        for (const [name, call] of Object.entries(calls[act])) {
          // A view's sort and grouping, a ship's dates: a member may, as before.
          const res = await call(who);
          expect([res.status, name]).not.toEqual([403, name]);
        }
      }
    }
  });

  it("only a signed-in owner or admin changes a switch, under one line on the feed", async () => {
    const { owner, p, bot } = await team();
    const admin = await person("Ada Admin");
    const member = await person("Mo Member");
    await join(p.id, admin, "admin");
    await join(p.id, member, "member");
    const since = (await ok(api(owner).get(`/api/projects/${p.id}/activity`))).now;

    await ok(setActs(admin, p.id, bot.id, { delete: true }));
    // A save that changes nothing writes no line.
    await ok(setActs(owner, p.id, bot.id, { delete: true, create: true }));
    expect((await setActs(member, p.id, bot.id, { create: false })).status).toBe(403);
    expect((await setActs(bot, p.id, bot.id, { delete: true })).status).toBe(403);
    const made = await api(owner).post("/api/auth/tokens", { name: "Laptop", days: 90 });
    const { secret } = (await made.json()) as { secret: string };
    const ownerToken = { ...owner, headers: { authorization: `Bearer ${secret}` } };
    expect((await setActs(ownerToken, p.id, bot.id, { create: false })).status).toBe(403);
    expect((await setActs(owner, p.id, bot.id, { fly: true })).status).toBe(400);
    expect((await setActs(owner, p.id, bot.id, { create: "no" })).status).toBe(400);

    const { agents } = await ok(api(owner).get(`/api/projects/${p.id}/agents`));
    expect(agents[0].acts).toEqual({ delete: true });
    const lines = (
      await ok(
        api(owner).get(
          `/api/projects/${p.id}/activity?after=${encodeURIComponent(since)}&limit=200`,
        ),
      )
    ).entries.filter((e: { kind: string }) => e.kind === "may");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      taskId: null,
      actor: { id: admin.id },
      data: { agentId: bot.id, agentName: "Switched", act: "delete", on: true },
    });
  });

  it("a stored act word the code no longer knows refuses nothing", async () => {
    const { owner, p, bot } = await team();
    expect(readAgentActs({ create: false, teleport: false, archive: "off", delete: true })).toEqual(
      {
        create: false,
        delete: true,
      },
    );
    expect(readAgentActs(null)).toEqual({});
    expect(readAgentActs(["create"])).toEqual({});
    await db
      .update(projectMembers)
      .set({ acts: { teleport: false, archive: "off", create: 0 } })
      .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, bot.id)));
    const calls = callsOf(owner, p.id);
    for (const act of AGENT_ACTS.filter((a) => a !== "delete")) {
      for (const call of Object.values(calls[act])) await passed(call(bot));
    }
    const me = await ok(bot.api.get("/api/agent/me"));
    expect(me.project.off).toEqual([{ act: "delete", words: "delete tasks" }]);
  });
});
