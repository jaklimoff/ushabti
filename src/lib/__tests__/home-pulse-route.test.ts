import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
/* Every statement counted, so a test can say the cost does not grow with the
   projects. */
const statements = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/db", async () => {
  const real = await import("@/test/db");
  const counted = new Set(["select", "selectDistinct", "update", "insert", "delete", "execute"]);
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
/* A board reads its runs through `loadOpenRuns` and nothing else does, so a
   call here is a board read. */
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

const { db } = await import("@/db");
const { projectMembers } = await import("@/db/schema");
const { agent, api, board, join, ok, person, project } = await import("@/test/route");
const { listProjectsWithPulse, loadBoard } = await import("@/lib/queries");
const { agentsAtWork, headingOf, mainColumns } = await import("@/lib/pulse");
const { BLOCKED_KEY } = await import("@/lib/filters");
const { dayBefore } = await import("@/lib/charts");

/*
 * Home's card for a project counts what the project's board shows. Home reads
 * only the part of each board the pulse needs, for every project at once, so
 * this holds the two together on a project seeded with what can tell them
 * apart: the main view's filter, the person's own lens, a blocker that is and
 * one that is no longer, an archived task, a current release, an agent at work
 * and one that waits, and somebody who left.
 */

type Prop = { id: string; name: string; options: { id: string; name: string }[] };
type Board = { properties: Prop[]; views: { id: string; isDefault: boolean }[]; today: string };

async function seeded(owner: Awaited<ReturnType<typeof person>>, groupBy = "Status") {
  const me = api(owner);
  const p = await project(owner);
  const first = (await board(owner, p.id)) as Board;
  const prop = (name: string) => first.properties.find((x) => x.name === name)!;
  const option = (name: string, of: string) => prop(name).options.find((o) => o.name === of)!.id;
  const main = first.views.find((v) => v.isDefault)!;

  // A release that is current today.
  await ok(
    me.post(`/api/projects/${p.id}/properties`, {
      name: "Version",
      type: "select",
      options: ["v1", "v2"],
    }),
  );
  const version = ((await board(owner, p.id)) as Board).properties.find(
    (x) => x.name === "Version",
  )!;
  await ok(me.patch(`/api/properties/${version.id}`, { dated: true }));
  await ok(me.post(`/api/projects/${p.id}/releases`));
  await ok(
    me.patch(`/api/options/${version.options[0].id}`, {
      startAt: dayBefore(first.today, 3),
      targetAt: dayBefore(first.today, -4),
    }),
  );

  const gone = await person("Somebody Who Left");
  await join(p.id, gone, "member");

  const make = async (title: string, values: Record<string, unknown>) =>
    (await ok<{ task: { id: string } }>(me.post(`/api/projects/${p.id}/tasks`, { title, values })))
      .task.id;
  const v1 = version.options[0].id;
  const a = await make("Plain", {
    [prop("Status").id]: option("Status", "Todo"),
    [version.id]: v1,
  });
  await make("Low, hidden by the view", {
    [prop("Status").id]: option("Status", "Todo"),
    [prop("Priority").id]: option("Priority", "Low"),
  });
  const c = await make("Blocked by a live one", {
    [prop("Status").id]: option("Status", "In Progress"),
  });
  const d = await make("Blocked by a done one", {
    [prop("Status").id]: option("Status", "Ready"),
    [prop("Assignee").id]: gone.id,
    [version.id]: v1,
  });
  const done = await make("Done", {
    [prop("Status").id]: option("Status", "Done"),
    [version.id]: v1,
  });
  const xl = await make("XL, hidden by the lens", {
    [prop("Status").id]: option("Status", "Backlog"),
    [prop("Estimate").id]: option("Estimate", "XL"),
  });
  const archived = await make("Archived", { [prop("Status").id]: option("Status", "Todo") });
  await make("No status at all", { [prop("Assignee").id]: owner.id });
  await ok(me.post(`/api/tasks/${c}/blockers`, { blockerId: a }));
  await ok(me.post(`/api/tasks/${d}/blockers`, { blockerId: done }));
  await ok(me.post(`/api/tasks/${archived}/archive`));
  // Leaving deletes only the membership, so the task still names them.
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, gone.id)));

  // An agent at work, and one that asked and waits.
  const bot = await agent(owner, p.id, "Builder");
  await ok(bot.api.post(`/api/tasks/${a}/run`, { goal: "Go" }));
  const asker = await agent(owner, p.id, "Asker");
  const asked = await ok(asker.api.post(`/api/tasks/${xl}/run`, { goal: "Ask" }));
  await ok(asker.api.patch(`/api/runs/${asked.run.id}`, { status: "waiting", step: "Which?" }));

  await ok(
    me.patch(`/api/views/${main.id}`, {
      groupById: prop(groupBy).id,
      filters: {
        rules: [
          { propertyId: prop("Priority").id, op: "is_not", values: [option("Priority", "Low")] },
        ],
      },
    }),
  );
  await ok(
    me.put(`/api/views/${main.id}/lens`, {
      filters: {
        rules: [
          { propertyId: prop("Estimate").id, op: "is_not", values: [option("Estimate", "XL")] },
          { propertyId: BLOCKED_KEY, op: "is", values: ["false"] },
        ],
      },
      sort: null,
    }),
  );
  return { project: p, blocked: c };
}

/** What the board this person opens says, by the readers the board draws with. */
async function boardSays(owner: Awaited<ReturnType<typeof person>>, projectId: string) {
  const full = await loadBoard(projectId, "owner", owner.id);
  const main = full.views.find((v) => v.isDefault) ?? full.views[0];
  return {
    full,
    pulse: {
      viewId: main.id,
      startFolded: main.startFolded,
      columns: mainColumns(full, owner.id),
      agents: agentsAtWork(full.runs),
      people: full.members.map((m) => ({ id: m.id, name: m.name, kind: m.kind, color: m.color })),
    },
  };
}

/* Six seeded projects take under a second alone, and past five seconds when
   the whole suite shares the machine. */
describe("Home's pulse", { timeout: 30_000 }, () => {
  it("counts what the board shows, under the view's filter and the person's lens", async () => {
    const owner = await person("Pulse Owner");
    const { project: p, blocked } = await seeded(owner);
    boards.count = 0;
    const { full, pulse } = await boardSays(owner, p.id);
    // The count sees a board when one is read.
    expect(boards.count).toBe(1);

    boards.count = 0;
    const [home] = await listProjectsWithPulse(owner.id);
    expect(boards.count).toBe(0);

    expect(home.pulse).toMatchObject(pulse);
    expect(home.pulse.heading).toEqual(headingOf(full, home.pulse.last));
    // The seed is one that can tell them apart.
    const counted = pulse.columns!.reduce((n, c) => n + c.count, 0);
    expect(counted).toBeGreaterThan(0);
    // Low, XL and the blocked one are on the board's list and in no column.
    expect(counted).toBe(full.tasks.length - 3);
    expect(full.tasks.find((t) => t.id === blocked)?.blockedBy).toHaveLength(1);
    expect(home.pulse.heading).toMatchObject({ kind: "release", done: 1, total: 3 });
    expect(home.pulse.agents).toEqual({ names: ["Builder"], silent: [] });
  });

  it("names somebody who left as the board does, on a board grouped by a person", async () => {
    const owner = await person("Pulse People");
    const { project: p } = await seeded(owner, "Assignee");
    const { pulse } = await boardSays(owner, p.id);
    const [home] = await listProjectsWithPulse(owner.id);
    expect(home.pulse.columns).toEqual(pulse.columns);
    expect(home.pulse.columns!.map((c) => c.name)).toContain("Somebody Who Left (left)");
  });

  it("takes as many statements for five projects as for one, and reads no board", async () => {
    const few = await person("Pulse One");
    await seeded(few);
    const many = await person("Pulse Five");
    for (let i = 0; i < 5; i++) await seeded(many);

    const cost = async (who: typeof few) => {
      statements.count = 0;
      boards.count = 0;
      const rows = await listProjectsWithPulse(who.id);
      return { rows, statements: statements.count, boards: boards.count };
    };
    const one = await cost(few);
    const five = await cost(many);
    expect(one.rows).toHaveLength(1);
    expect(five.rows).toHaveLength(5);
    expect(five.statements).toBe(one.statements);
    expect(one.boards + five.boards).toBe(0);
  });
});
