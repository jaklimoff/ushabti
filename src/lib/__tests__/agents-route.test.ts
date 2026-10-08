import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, backdateRun, board, ok, person, project, task } = await import("@/test/route");

/*
 * The answers an agent gets from the run routes, the token and the refusals.
 * Each test here was a test of `e2e/agents.spec.ts` and carries its name. The
 * first run on the board, the drag that takes a card over and the silent run
 * that closes itself stayed there; the panel halves are `AgentTab.test.tsx`.
 */

type Run = { id: string; status: string; reportDueAt: string | null; log: { text: string }[] };

/** A project with one task, and an agent holding a run on it. */
async function running(title: string, open: Record<string, unknown> = {}) {
  const owner = await person("Owner");
  const p = await project(owner);
  const t = await task(owner, p.id, title);
  const bot = await agent(owner, p.id);
  const started = await bot.api.post(`/api/tasks/${t.id}/run`, {
    goal: "Do the work",
    step: "Working",
    ...open,
  });
  expect(started.status).toBe(201);
  const { run } = (await started.json()) as { run: Run };
  const readRun = async () => (await ok<{ run: Run }>(bot.api.get(`/api/runs/${run.id}`))).run;
  return { owner, project: p, task: t, bot, run, readRun };
}

describe("Agents on the board", () => {
  it("a beat says the agent is alive and says nothing else", async () => {
    const {
      bot,
      run,
      readRun,
      owner,
      project: p,
    } = await running("Held through a long build", {
      step: "Running the build",
    });
    const beatOnce = async () =>
      expect((await bot.api.patch(`/api/runs/${run.id}`, { beat: true })).ok).toBe(true);

    /* The claim stamps `beat_at` with the database clock and a beat with the
       server's, so one beat comes first. */
    await beatOnce();
    const before = await readRun();
    let after = before;
    await expect
      .poll(async () => {
        await beatOnce();
        after = await readRun();
        return new Date((after as unknown as { beatAt: string }).beatAt).getTime();
      })
      .toBeGreaterThan(new Date((before as unknown as { beatAt: string }).beatAt).getTime());

    // A timer does no work, so it must not be able to look like progress.
    expect(after).toMatchObject({
      updatedAt: (before as unknown as { updatedAt: string }).updatedAt,
      step: "Running the build",
    });
    expect(after.log).toHaveLength(before.log.length);
    expect((await board(owner, p.id)).runs[0].step).toBe("Running the build");

    // A run that is over answers a beat the same way it answers a report.
    await bot.api.patch(`/api/runs/${run.id}`, { status: "done" });
    expect((await bot.api.patch(`/api/runs/${run.id}`, { beat: true })).status).toBe(409);
  });

  /* The other half of `lost`: an agent being shut down reports it itself,
     inside its lease, and the feed must not say the board closed it. */
  it("an agent that says it is being shut down reads as shut down", async () => {
    const { bot, run, owner, project: p } = await running("Stopped with its session");
    const since = (await ok(api(owner).get(`/api/projects/${p.id}/activity`))).now;

    await bot.api.patch(`/api/runs/${run.id}`, { status: "lost", log: "the agent was stopped" });

    const { entries } = await ok(
      api(owner).get(`/api/projects/${p.id}/activity?after=${encodeURIComponent(since)}`),
    );
    const ended = entries.filter((e: { kind: string }) => e.kind === "run");
    expect(ended.map((e: { data: unknown }) => e.data)).toEqual([{ action: "lost", by: "agent" }]);
  });

  /* The route is the second door: whatever made the report, `lost` cannot end
     a run that waits on purpose. The first door, the heartbeat that reads the
     run before it writes, is `skill-beat.test.ts`. */
  it("the board refuses a lost report on a run that waits", async () => {
    const { bot, run, readRun } = await running("Handed to a reviewer");
    await bot.api.patch(`/api/runs/${run.id}`, { status: "handed_over", step: "review" });

    const refused = await bot.api.patch(`/api/runs/${run.id}`, { status: "lost" });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe(
      "That run waits on purpose, so a lost report cannot end it.",
    );
    expect((await readRun()).status).toBe("handed_over");
  });

  it("a long step says how long it takes, and the board waits for it", async () => {
    const { bot, run, readRun, owner, project: p } = await running("A suite that runs for an hour");
    expect(run.reportDueAt).toBeNull();
    const held = async () => (await board(owner, p.id)).runs.some((r: Run) => r.id === run.id);

    // What `board.mjs step --for 45` sends.
    await ok(
      bot.api.patch(`/api/runs/${run.id}`, { step: "Running the whole suite", reportFor: 45 }),
    );
    const stretched = await readRun();
    const ahead = new Date(stretched.reportDueAt!).getTime() - Date.now();
    expect(ahead).toBeGreaterThan(44 * 60_000);
    expect(ahead).toBeLessThanOrEqual(45 * 60_000);

    // A beat moves neither clock.
    await bot.api.patch(`/api/runs/${run.id}`, { beat: true });
    expect((await readRun()).reportDueAt).toBe(stretched.reportDueAt);

    // Forty minutes of silence: past the thirty that would close any other run.
    await backdateRun(run.id, 40);
    expect(await held()).toBe(true);

    // The next report puts the ordinary lease back, beat or no beat.
    await ok(bot.api.patch(`/api/runs/${run.id}`, { step: "The suite passed" }));
    expect((await readRun()).reportDueAt).toBeNull();
    await backdateRun(run.id, 40);
    await bot.api.patch(`/api/runs/${run.id}`, { beat: true });
    expect(await held()).toBe(false);
    expect((await bot.api.patch(`/api/runs/${run.id}`, { step: "Back!" })).status).toBe(409);
  });

  it("a token only opens its own project, and a revoked one opens nothing", async () => {
    const owner = await person("Two Projects");
    const first = await project(owner);
    const second = await project(owner);
    const reader = await agent(owner, first.id, "Reader");

    expect((await reader.api.get(`/api/projects/${first.id}/board`)).ok).toBe(true);
    expect((await reader.api.get(`/api/projects/${second.id}/board`)).status).toBe(403);
    // An agent is a member, not an owner: it cannot make more of itself.
    expect(
      (await reader.api.post(`/api/projects/${first.id}/agents`, { name: "Copy" })).status,
    ).toBe(403);

    await ok(api(owner).del(`/api/agent-tokens/${reader.tokenId}`));
    expect((await reader.api.get(`/api/projects/${first.id}/board`)).status).toBe(401);
  });

  /* A lens is one person's screen. An agent works from the board the team
     shares, so it never reads one and never writes one. */
  it("an agent reads the view's filters and never a person's own", async () => {
    const owner = await person("Lens Owner");
    const p = await project(owner);
    const looker = await agent(owner, p.id, "Looker");
    const data = await board(owner, p.id);
    const priority = data.properties.find((x: { name: string }) => x.name === "Priority");
    const urgent = priority.options.find((o: { name: string }) => o.name === "Urgent").id;
    const viewId = data.views[0].id;
    const rules = [{ propertyId: priority.id, op: "is", values: [urgent] }];

    await ok(api(owner).put(`/api/views/${viewId}/lens`, { filters: { rules }, sort: null }));
    expect((await board(owner, p.id)).views[0].lens.rules).toHaveLength(1);

    // The person's board is narrowed. The agent's is not.
    for (const view of (await board(looker, p.id)).views) {
      expect(view.filters.rules).toEqual([]);
      expect(view.lens.rules).toEqual([]);
    }
    expect(
      (await looker.api.put(`/api/views/${viewId}/lens`, { filters: { rules: [] } })).status,
    ).toBe(403);
    expect((await looker.api.post(`/api/views/${viewId}/lens/promote`)).status).toBe(403);

    // Once a person puts the rules on the view, they are the board's own.
    await ok(api(owner).post(`/api/views/${viewId}/lens/promote`));
    const view = (await board(looker, p.id)).views.find((v: { id: string }) => v.id === viewId);
    expect(view.filters.rules).toHaveLength(1);
    expect(view.lens.rules).toEqual([]);
  });

  // The agent's half; the panel's is in AgentTab.test.tsx.
  it("a run that is over can still be read on the task", async () => {
    const {
      bot,
      run,
      task: t,
    } = await running("Worked on yesterday", {
      goal: "Write the queue tests",
      steps: ["Read the queue module", "Write the tests"],
    });
    await bot.api.patch(`/api/runs/${run.id}`, { step: "Writing the tests", stepIndex: 1 });
    await bot.api.patch(`/api/runs/${run.id}`, { status: "done", log: "opened PR #124" });

    const { task: detail } = await ok(bot.api.get(`/api/tasks/${t.id}`));
    expect(detail.run).toBeNull();
    expect(detail.pastRuns).toHaveLength(1);
    expect(detail.pastRuns[0]).toMatchObject({
      status: "done",
      goal: "Write the queue tests",
      agent: { name: "Builder" },
    });
    // A row is the run and nothing read off another table.
    expect(detail.pastRuns[0]).not.toHaveProperty("stepsTotal");
    expect(detail.pastRuns[0]).not.toHaveProperty("lastLog");
  });

  // The route's half; the panel's is in AgentTab.test.tsx.
  it("a removed agent leaves its runs on the task", async () => {
    const {
      bot,
      run,
      owner,
      project: p,
      task: t,
    } = await running("Worked on before removal", {
      goal: "Leave a record",
      steps: ["Plan the work", "Do the work"],
    });
    await bot.api.patch(`/api/runs/${run.id}`, { status: "done", log: "left a line in the log" });

    await ok(api(owner).del(`/api/projects/${p.id}/agents/${bot.id}`));

    // What goes: the token opens nothing.
    expect((await bot.api.get(`/api/projects/${p.id}/board`)).status).toBe(401);

    // What stays: the run, its plan and its log, under the agent's name.
    const { task: detail } = await ok(api(owner).get(`/api/tasks/${t.id}`));
    expect(detail.pastRuns[0]).toMatchObject({
      goal: "Leave a record",
      agent: { name: "Builder" },
    });
    const { run: kept } = await ok(api(owner).get(`/api/runs/${run.id}`));
    expect(kept.steps.map((s: { text: string }) => s.text)).toContain("Plan the work");
    expect(kept.log.map((l: { text: string }) => l.text)).toContain("left a line in the log");
  });

  it("an agent may write the board but not take it apart", async () => {
    const { bot, owner, project: p, task: t } = await running("The agent works on this");
    const data = await board(owner, p.id);

    // Content is shared: it writes values and comments like anybody else.
    const status = data.properties.find((x: { name: string }) => x.name === "Status");
    const ready = status.options.find((o: { name: string }) => o.name === "Ready");
    expect(
      (await bot.api.put(`/api/tasks/${t.id}/values/${status.id}`, { value: ready.id })).ok,
    ).toBe(true);
    expect((await bot.api.post(`/api/tasks/${t.id}/comments`, { body: "On it." })).status).toBe(
      201,
    );

    // Structure is the owner's, and only a person's.
    const spare = data.properties.find((x: { name: string }) => x.name === "Estimate");
    const extraView = data.views.find((v: { isDefault: boolean }) => !v.isDefault);
    expect((await bot.api.del(`/api/properties/${spare.id}`)).status).toBe(403);
    expect((await bot.api.del(`/api/views/${extraView.id}`)).status).toBe(403);
    expect((await bot.api.del(`/api/options/${ready.id}`)).status).toBe(403);

    // A filter says what everybody can see; a loose token must not hide the work.
    const hide = await bot.api.patch(`/api/views/${extraView.id}`, {
      filters: { rules: [{ propertyId: status.id, op: "is", values: [ready.id] }] },
    });
    expect(hide.status).toBe(403);

    // Pause and Stop mean nothing if the agent can write them itself.
    const { runs } = await board(owner, p.id);
    expect(
      (await bot.api.post(`/api/runs/${runs[0].id}/control`, { control: "resume" })).status,
    ).toBe(403);
  });
});
