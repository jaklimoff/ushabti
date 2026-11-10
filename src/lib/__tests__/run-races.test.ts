import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

/*
 * A report reads the run first and writes it a moment later. `between` runs in
 * that moment, so a test can put a person's press or the lease exactly where
 * the race would put it.
 */
const hook = vi.hoisted(() => ({
  between: null as null | (() => Promise<void>),
  claiming: null as null | ((tx: unknown) => Promise<void>),
}));
vi.mock("@/lib/runs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/runs")>();
  return {
    ...real,
    runContext: async (runId: string) => {
      const read = await real.runContext(runId);
      const between = hook.between;
      hook.between = null;
      if (between) await between();
      return read;
    },
    // A claim's window: after it looked at the task, before it opened its run.
    closeHandOver: async (...args: Parameters<typeof real.closeHandOver>) => {
      const claiming = hook.claiming;
      hook.claiming = null;
      if (claiming) await claiming(args[0]);
      return real.closeHandOver(...args);
    },
  };
});

const { db } = await import("@/db");
const { agent, api, backdateRun, board, ok, person, project, task } = await import("@/test/route");

afterEach(() => {
  hook.between = null;
  hook.claiming = null;
});

async function setUp() {
  const owner = await person("Race Owner");
  const p = await project(owner);
  const t = await task(owner, p.id, "Make the queue retry");
  const bot = await agent(owner, p.id, "Builder");
  return { owner, project: p, task: t, bot };
}

async function row(runId: string) {
  const { rows } = await db.execute<{
    status: string;
    control: string | null;
    ended_at: unknown;
    updated_at: unknown;
  }>(sql`select status, control, ended_at, updated_at from agent_runs where id = ${runId}`);
  return rows[0];
}

const claim = (bot: Awaited<ReturnType<typeof agent>>, taskId: string) =>
  bot.api.post(`/api/tasks/${taskId}/run`, { goal: "Work", steps: ["Read", "Write", "Ship"] });

describe("A report that crosses the end of its run", () => {
  it("answers 409 after Take over, and the run stays closed", async () => {
    const { owner, task: t, bot } = await setUp();
    const run = (await ok(claim(bot, t.id))).run;
    await ok(api(owner).post(`/api/runs/${run.id}/control`, { control: "take_over" }));

    const late = await bot.api.patch(`/api/runs/${run.id}`, { status: "running", step: "More" });
    expect(late.status).toBe(409);
    expect((await late.json()).error).toBe("That run is over.");
    expect(await row(run.id)).toMatchObject({ status: "taken_over" });
  });

  it("answers 409 when Take over lands after the report read the run", async () => {
    const { owner, task: t, bot } = await setUp();
    const run = (await ok(claim(bot, t.id))).run;
    hook.between = async () => {
      await ok(api(owner).post(`/api/runs/${run.id}/control`, { control: "take_over" }));
    };

    const late = await bot.api.patch(`/api/runs/${run.id}`, {
      status: "done",
      steps: ["One", "Two"],
      stepIndex: 1,
      log: "opened PR #12",
    });
    expect(late.status).toBe(409);
    expect((await late.json()).error).toBe("That run is over.");
    const after = await row(run.id);
    expect(after.status).toBe("taken_over");
    expect(after.ended_at).not.toBeNull();
    // Nothing of the report landed: the plan is still the claim's.
    const { rows } = await db.execute<{ text: string }>(
      sql`select text from agent_run_steps where run_id = ${run.id} order by index`,
    );
    expect(rows.map((r) => r.text)).toEqual(["Read", "Write", "Ship"]);
  });

  it("does not let a second close write over the first", async () => {
    const { owner, task: t, bot } = await setUp();
    const run = (await ok(claim(bot, t.id))).run;
    hook.between = async () => {
      await ok(bot.api.patch(`/api/runs/${run.id}`, { status: "done" }));
    };
    const press = await api(owner).post(`/api/runs/${run.id}/control`, { control: "take_over" });
    expect(press.status).toBe(409);
    expect(await row(run.id)).toMatchObject({ status: "done" });
  });
});

describe("Two claims on one free task", () => {
  it("give one run and one 409, never a 500", async () => {
    const { owner, project: p, task: t, bot } = await setUp();
    const other = await agent(owner, p.id, "Reviewer");
    const answers = await Promise.all([claim(bot, t.id), claim(other, t.id)]);
    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    const lost = answers.find((a) => a.status === 409)!;
    expect((await lost.json()).error).toBe("Another run is already open on this task.");
    const { rows } = await db.execute(
      sql`select id from agent_runs where task_id = ${t.id} and ended_at is null`,
    );
    expect(rows).toHaveLength(1);
  });
  it("answers 409 when the other claim's run lands while this one is claiming", async () => {
    const { owner, project: p, task: t, bot } = await setUp();
    const other = await agent(owner, p.id, "Reviewer");
    /* On Postgres the other claim commits from its own connection; here it
       is written in this transaction, which the open-run index sees the same. */
    hook.claiming = async (tx) => {
      await (tx as typeof db).execute(
        sql`insert into agent_runs (project_id, task_id, agent_id, goal, step)
            values (${p.id}, ${t.id}, ${other.id}, 'Review', '')`,
      );
    };
    const answer = await claim(bot, t.id);
    expect(answer.status).toBe(409);
    expect((await answer.json()).error).toBe("Another run is already open on this task.");
  });
});

describe("Pause, Resume and Stop", () => {
  it("leave updated_at, the agent's last word, where it was", async () => {
    const { owner, task: t, bot } = await setUp();
    const run = (await ok(claim(bot, t.id))).run;
    await backdateRun(run.id, 5);
    const before = (await row(run.id)).updated_at;
    for (const control of ["pause", "resume", "stop"]) {
      await ok(api(owner).post(`/api/runs/${run.id}/control`, { control }));
      const now = await row(run.id);
      expect(now.control).toBe(control);
      expect(now.updated_at).toEqual(before);
    }
  });

  it("do not renew the lease of an agent that went quiet", async () => {
    const { owner, project: p, task: t, bot } = await setUp();
    const run = (await ok(claim(bot, t.id))).run;
    await backdateRun(run.id, 45);
    await ok(api(owner).post(`/api/runs/${run.id}/control`, { control: "stop" }));
    // The board's read sweeps, and the Stop kept nobody's card open.
    await board(owner, p.id);
    expect(await row(run.id)).toMatchObject({ status: "lost" });
  });
});

describe("A report and a Stop written after it read the run", () => {
  it("keeps the Stop", async () => {
    const { owner, task: t, bot } = await setUp();
    const run = (await ok(claim(bot, t.id))).run;
    await ok(api(owner).post(`/api/runs/${run.id}/control`, { control: "pause" }));
    hook.between = async () => {
      await ok(api(owner).post(`/api/runs/${run.id}/control`, { control: "stop" }));
    };
    // The agent obeys the Pause it read; the Stop is still owed.
    const answer = await ok(bot.api.patch(`/api/runs/${run.id}`, { status: "paused" }));
    expect(answer.control).toBe("stop");
    expect(await row(run.id)).toMatchObject({ status: "paused", control: "stop" });
  });

  it("still clears the word it obeyed when nothing crossed it", async () => {
    const { owner, task: t, bot } = await setUp();
    const run = (await ok(claim(bot, t.id))).run;
    await ok(api(owner).post(`/api/runs/${run.id}/control`, { control: "pause" }));
    const answer = await ok(bot.api.patch(`/api/runs/${run.id}`, { status: "paused" }));
    expect(answer.control).toBeNull();
  });
});

describe("A plan's current step", () => {
  it("is written in one statement, before done and after todo", async () => {
    const { task: t, bot } = await setUp();
    const run = (await ok(claim(bot, t.id))).run;
    const { run: after } = await ok(bot.api.patch(`/api/runs/${run.id}`, { stepIndex: 1 }));
    expect(after.steps.map((s: { state: string }) => s.state)).toEqual(["done", "active", "todo"]);
  });
});
