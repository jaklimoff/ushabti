import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
/* The test database, with every statement counted, so a test can say the
   reader's cost does not grow with the projects. */
const statements = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/db", async () => {
  const real = await import("@/test/db");
  const counted = new Set(["select", "update", "insert", "delete", "execute"]);
  const db = new Proxy(real.db, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof key !== "string" || !counted.has(key) || typeof value !== "function") return value;
      return (...args: unknown[]) => {
        statements.count += 1;
        return value(...args);
      };
    },
  });
  return { ...real, db };
});
vi.mock("next/headers", () => import("@/test/headers"));
/* No board is read: the board's runs come only through `loadOpenRuns`. */
const boards = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/runs", async (original) => {
  const real = await original<typeof import("@/lib/runs")>();
  return {
    ...real,
    loadOpenRuns: (projectId: string) => {
      boards.count += 1;
      return real.loadOpenRuns(projectId);
    },
  };
});

const { agent, api, backdateRun, join, ok, person, project, task } = await import("@/test/route");
const { listProjectsNow, listProjectsWithPulse } = await import("@/lib/queries");

/*
 * `GET /api/home/projects`: every project of a person with who is at work,
 * for a page that follows all of them. It must stay cheap, because the page
 * reads it on every `elsewhere`, and it must name an agent as Home does.
 */

type Caller = Awaited<ReturnType<typeof person>>;

async function claim(bot: Awaited<ReturnType<typeof agent>>, taskId: string) {
  return (await ok(bot.api.post(`/api/tasks/${taskId}/run`, { goal: "Go" }))).run as {
    id: string;
  };
}

/** A project with an agent at work on one task. */
async function busy(owner: Caller, name: string) {
  const p = await project(owner, name);
  const bot = await agent(owner, p.id, `${name} bot`);
  const t = await task(owner, p.id, "Work");
  const run = await claim(bot, t.id);
  return { project: p, bot, task: t, run };
}

async function cost(who: Caller) {
  statements.count = 0;
  boards.count = 0;
  const projects = await listProjectsNow(who.id);
  return { projects, statements: statements.count, boards: boards.count };
}

describe("Every project of a person, with who is at work", () => {
  it("takes as many statements for five projects as for one, and reads no board", async () => {
    const few = await person("One Project");
    await busy(few, "Lone");
    const many = await person("Five Projects");
    for (const name of ["A", "B", "C", "D", "E"]) await busy(many, `Many ${name}`);

    const one = await cost(few);
    const five = await cost(many);
    expect(one.projects).toHaveLength(1);
    expect(five.projects).toHaveLength(5);
    expect(five.projects.every((p) => p.agents.length === 1)).toBe(true);
    expect(five.statements).toBe(one.statements);
    expect(one.boards + five.boards).toBe(0);
  });

  it("answers in the person's Home order, with the newest line of the feed", async () => {
    const me = await person("Ordered");
    const a = await project(me, "First made");
    const b = await project(me, "Second made");
    await task(me, b.id, "Something happened");
    const listed = await ok<{ projects: { id: string; lastAt: string | null }[] }>(
      api(me).get("/api/home/projects"),
    );
    // Each new project goes to the top, as on Home.
    expect(listed.projects.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(Date.parse(listed.projects[0].lastAt ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect(listed.projects[1].lastAt).toBeNull();
  });

  it("names working and silent agents exactly as Home does", async () => {
    const owner = await person("Same Words");
    const { project: p, bot, run } = await busy(owner, "Words");
    const quiet = await agent(owner, p.id, "Quiet one");
    const t = await task(owner, p.id, "Other work");
    const still = await claim(quiet, t.id);
    // Ten minutes without a word or a beat: silent, and still inside the lease.
    await backdateRun(still.id, 10);

    const [now] = await listProjectsNow(owner.id);
    boards.count = 0;
    const [home] = await listProjectsWithPulse(owner.id);
    // The count above sees a board when one is read.
    expect(boards.count).toBe(1);
    const working = now.agents.filter((a) => a.working).map((a) => a.name);
    const silent = now.agents.filter((a) => !a.working).map((a) => a.name);
    expect(working).toEqual(home.pulse.agents.names);
    expect(silent).toEqual(home.pulse.agents.silent);
    expect(working).toEqual([bot.name]);
    expect(silent).toEqual(["Quiet one"]);
    expect(now.agents.find((a) => a.name === bot.name)?.taskKey).toMatch(/^[A-Z0-9]+-\d+$/);
    expect(run.id).toBeTruthy();
  });

  it("counts a run that waits in waiting, and not as at work", async () => {
    const owner = await person("Asked");
    const { project: p, bot, run } = await busy(owner, "Asks");
    await ok(bot.api.patch(`/api/runs/${run.id}`, { status: "waiting", step: "Which queue?" }));

    const [now] = await listProjectsNow(owner.id);
    expect(now.id).toBe(p.id);
    expect(now.waiting).toBe(1);
    expect(now.agents).toEqual([]);
  });

  it("names only the person's own projects, and refuses an agent", async () => {
    const owner = await person("Owner Here");
    const { project: p, bot } = await busy(owner, "Shared");
    await project(owner, "Not shared");
    const member = await person("Member Here");
    await join(p.id, member, "member");

    const theirs = await ok<{ projects: { id: string }[] }>(api(member).get("/api/home/projects"));
    expect(theirs.projects.map((x) => x.id)).toEqual([p.id]);

    const refused = await bot.api.get("/api/home/projects");
    expect(refused.status).toBe(403);
    expect((await api(null).get("/api/home/projects")).status).toBe(401);
  });
});
