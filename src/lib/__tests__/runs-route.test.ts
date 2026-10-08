import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/db");
const { agent, api, backdateRun, board, ok, person, project, task } = await import("@/test/route");

/*
 * The server's half of the runs a person reads and answers: the pages of a
 * log and of the runs of a task, a run that waits, a hand-over, and the
 * number of questions a project holds. Each test was a test of
 * `e2e/run-history.spec.ts`, `e2e/listening.spec.ts` or
 * `e2e/project-waiting.spec.ts`, and carries its name. The panel's half is in
 * `AgentTab.test.tsx`.
 */

type Line = { id: string; text: string };

/** A project with the given tasks, and an agent called `name`. */
async function setUp(titles: string[], name = "Scribe") {
  const owner = await person("History Owner");
  const p = await project(owner);
  const tasks = [];
  for (const title of titles) tasks.push(await task(owner, p.id, title));
  const bot = await agent(owner, p.id, name);
  return { owner, project: p, tasks, bot };
}

async function claim(bot: Awaited<ReturnType<typeof agent>>, taskId: string, goal = "Work") {
  return (await ok(bot.api.post(`/api/tasks/${taskId}/run`, { goal }))).run as { id: string };
}

describe("Reading every line and every run", () => {
  it("a 300-line log reads from its first line, and a new line keeps the old ones", async () => {
    const { tasks, bot } = await setUp(["A long log"]);
    const run = await claim(bot, tasks[0].id, "Write a lot");
    /* The claim wrote "started: …"; these make the log three hundred lines,
       thirty to a moment as a transaction writes them, the first alone and
       oldest. */
    await db.execute(sql`
      insert into agent_run_log (run_id, text, created_at)
      select ${run.id}, 'line ' || lpad(n::text, 3, '0'),
             case when n = 1 then now() - interval '1 day'
                  else now() - interval '1 hour' + ((n - 2) / 30) * interval '1 second' end
        from generate_series(1, 299) as n`);

    const tail = (await ok(bot.api.get(`/api/runs/${run.id}`))).run;
    expect(tail.log).toHaveLength(40);
    expect(tail.logMore).toBe(true);
    const seen: Line[] = [...tail.log];
    let cursor = tail.log[0].id;
    let pages = 0;
    for (;;) {
      const page = (await ok(bot.api.get(`/api/runs/${run.id}?before=${cursor}`))) as {
        lines: Line[];
        more: boolean;
      };
      pages += 1;
      expect(page.lines.length).toBeLessThanOrEqual(100);
      // Newest first, so the oldest is last and is the next cursor.
      seen.unshift(...[...page.lines].reverse());
      if (!page.more) break;
      cursor = page.lines.at(-1)!.id;
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(300);
    expect(new Set(seen.map((l) => l.id)).size).toBe(300);
    expect(new Set(seen.map((l) => l.text)).size).toBe(300);
    expect(seen[0].text).toBe("line 001");

    // A line of another run, or no line at all, is not a cursor.
    expect((await bot.api.get(`/api/runs/${run.id}?before=nope`)).status).toBe(400);
    expect(
      (await bot.api.get(`/api/runs/${run.id}?before=00000000-0000-4000-8000-000000000000`)).status,
    ).toBe(404);

    // The run writes on, and the newest line ends the tail.
    await ok(bot.api.patch(`/api/runs/${run.id}`, { log: "one more line" }));
    expect((await ok(bot.api.get(`/api/runs/${run.id}`))).run.log.at(-1).text).toBe(
      "one more line",
    );
  });

  it("a task with 40 runs says so and shows them all", async () => {
    const { project: p, tasks, bot } = await setUp(["Run many times"]);
    // Forty closed runs, two to a moment, so the cursor has ties to cross.
    await db.execute(sql`
      insert into agent_runs (project_id, task_id, agent_id, goal, step, status,
                              started_at, updated_at, beat_at, ended_at)
      select ${p.id}, ${tasks[0].id}, ${bot.id}, 'goal ' || lpad(n::text, 2, '0'), 'done', 'done',
             now() - interval '2 days' + (n / 2) * interval '1 minute',
             now() - interval '1 day', now() - interval '1 day', now() - interval '1 day'
        from generate_series(1, 40) as n`);

    const detail = (await ok(bot.api.get(`/api/tasks/${tasks[0].id}`))).task;
    expect(detail.pastRuns).toHaveLength(20);
    expect(detail.pastRunsTotal).toBe(40);
    const next = await ok(
      bot.api.get(`/api/tasks/${tasks[0].id}/runs?before=${detail.pastRuns.at(-1).id}`),
    );
    expect(next.runs).toHaveLength(20);
    expect(next.more).toBe(false);
    const ids = [...detail.pastRuns, ...next.runs].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(40);
  });
});

describe("Agents that wait for work", () => {
  it("a waiting run shows its question, keeps its card, and hears the answer", async () => {
    const { owner, project: p, tasks, bot } = await setUp(["Make the queue retry"], "Asker");
    const t = tasks[0];
    const since = (await ok(bot.api.get(`/api/projects/${p.id}/activity`))).now;
    const run = await claim(bot, t.id, "Refine it");
    await ok(
      bot.api.post(`/api/tasks/${t.id}/comments`, { body: "Which service owns the queue?" }),
    );
    await ok(
      bot.api.patch(`/api/runs/${run.id}`, {
        status: "waiting",
        step: "Which service owns the queue?",
      }),
    );

    // A person answers in a comment, and the feed carries it and who gave it.
    await ok(api(owner).post(`/api/tasks/${t.id}/comments`, { body: "The billing service." }));
    const feed = await ok(
      bot.api.get(`/api/projects/${p.id}/activity?after=${encodeURIComponent(since)}`),
    );
    const answer = feed.entries.find(
      (e: { kind: string; actor: { kind: string } | null }) =>
        e.kind === "comment" && e.actor?.kind === "human",
    );
    expect(answer).toMatchObject({ taskKey: t.key, data: { commentId: expect.any(String) } });

    // Silence is the point of waiting, so the lease leaves it.
    await backdateRun(run.id, 45);
    const held = (await board(owner, p.id)).runs.find((r: { id: string }) => r.id === run.id);
    expect(held).toMatchObject({ status: "waiting", step: "Which service owns the queue?" });

    await ok(
      bot.api.patch(`/api/runs/${run.id}`, { status: "running", step: "Reading the answer" }),
    );
  });

  it("a run hands the task on, and the next claim closes it", async () => {
    const {
      owner,
      project: p,
      tasks,
      bot,
    } = await setUp(["Make the queue retry", "Ship the docs"], "Builder");
    const reviewer = await agent(owner, p.id, "Reviewer");
    const [first, second] = [await claim(bot, tasks[0].id), await claim(bot, tasks[1].id)];

    // A hand-over to nobody is refused at the route's door.
    const bare = await bot.api.patch(`/api/runs/${first.id}`, { status: "handed_over" });
    expect(bare.status).toBe(400);
    expect((await bare.json()).error).toContain("who has the task");
    expect((await ok(bot.api.get(`/api/runs/${first.id}`))).run.status).toBe("running");

    for (const run of [first, second]) {
      await ok(bot.api.patch(`/api/runs/${run.id}`, { status: "handed_over", step: "review" }));
    }

    // It stopped on purpose, so the lease leaves it alone.
    await backdateRun(first.id, 45);
    const held = (await board(owner, p.id)).runs.find((r: { id: string }) => r.id === first.id);
    expect(held).toMatchObject({ status: "handed_over", step: "review" });

    // The next agent claims: one run closes, the next opens.
    await claim(reviewer, tasks[0].id, "Review the branch");
    const { task: detail } = await ok(reviewer.api.get(`/api/tasks/${tasks[0].id}`));
    expect(detail.run.agent.name).toBe("Reviewer");
    expect(detail.pastRuns[0]).toMatchObject({ status: "done", agent: { name: "Builder" } });

    // And Take over still ends one, as it ends any open run.
    await ok(api(owner).post(`/api/runs/${second.id}/control`, { control: "take_over" }));
    const open = (await board(owner, p.id)).runs.map((r: { taskId: string }) => r.taskId);
    expect(open).toEqual([tasks[0].id]);
  });
});

describe("How many tasks wait in each project", () => {
  it("is read by the list, the switcher and the All projects page", async () => {
    const owner = await person("Many Projects");
    const asked = await project(owner);
    const quiet = await project(owner);
    const bot = await agent(owner, asked.id, "Asker");
    const run = async (title: string, status?: string) => {
      const t = await task(bot, asked.id, title);
      const { id } = await claim(bot, t.id, title);
      if (status) await ok(bot.api.patch(`/api/runs/${id}`, { status, step: "Which queue?" }));
      return t.id;
    };
    await run("Asks", "waiting");
    const archived = await run("Asks, then archived", "waiting");
    const deleted = await run("Asks, then deleted", "waiting");
    await run("Hands it over", "handed_over");
    await run("Just works");
    await ok(api(owner).post(`/api/tasks/${archived}/archive`));
    await ok(api(owner).del(`/api/tasks/${deleted}`));

    /* One ask is left: the archived and the deleted task are on no board, and
       a hand-over waits for nobody in particular. The switcher and the All
       projects page draw this number as it comes. */
    const { projects } = await ok(api(owner).get("/api/projects"));
    const byId = (id: string) => projects.find((x: { id: string }) => x.id === id);
    expect(byId(asked.id).waiting).toBe(1);
    expect(byId(quiet.id).waiting).toBe(0);

    // An agent cannot list projects, so it reads the number on its own one.
    expect((await ok(bot.api.get("/api/agent/me"))).project.waiting).toBe(1);
  });
});
