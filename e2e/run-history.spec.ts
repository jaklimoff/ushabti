import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  addTask,
  card,
  createProject,
  gotoSettings,
  inDatabase,
  register,
  unique,
} from "./helpers";

type Line = { id: string; text: string };

/** An agent on a new project, with a token and the one task it works on. */
async function agentOnATask(page: Page, request: APIRequestContext, title: string) {
  await register(page, "History Owner");
  const projectId = await createProject(page, unique("History"));
  await addTask(page, "Todo", title);
  await page.getByRole("button", { name: "Close task" }).click();

  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill("Scribe");
  await page.getByRole("button", { name: "Add agent" }).click();
  const agentBox = page.getByTestId("agent-box").filter({ hasText: "Scribe" });
  await agentBox.getByRole("button", { name: "Connect" }).click();
  await agentBox.getByRole("button", { name: "Make token" }).click();
  const token = (
    (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
  ).trim();

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "x-forwarded-for": unique("198.51.100"),
  };
  const api = {
    get: (path: string) => request.get(path, { headers }),
    post: (path: string, data: unknown = {}) => request.post(path, { headers, data }),
    patch: (path: string, data: unknown = {}) => request.patch(path, { headers, data }),
  };
  const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
  const task = board.tasks.find((t: { title: string }) => t.title === title);
  return { projectId, task, api };
}

/**
 * Writes lines straight into the log, `perMoment` of them sharing one
 * `created_at`, as a transaction does. The first line is alone and oldest, so
 * a reader can tell it reached the start.
 */
async function writeLines(runId: string, from: number, count: number, perMoment: number) {
  await inDatabase(async (client) => {
    await client.query(
      `insert into agent_run_log (run_id, text, created_at)
       select $1, 'line ' || lpad(n::text, 3, '0'),
              case when n = 1 then now() - interval '1 day'
                   else now() - interval '1 hour' + ((n - 2) / $4) * interval '1 second' end
         from generate_series($2::int, $2::int + $3::int - 1) as n`,
      [runId, from, count, perMoment],
    );
  });
}

test.describe("Reading every line and every run", () => {
  test("a 300-line log reads from its first line, and a new line keeps the old ones", async ({
    page,
    request,
  }) => {
    const { projectId, task, api } = await agentOnATask(page, request, "A long log");
    const { run } = await (
      await api.post(`/api/tasks/${task.id}/run`, { goal: "Write a lot" })
    ).json();
    // The claim wrote "started: …"; these make the log three hundred lines.
    await writeLines(run.id, 1, 299, 30);

    /* ---- the API: the tail and every page, each line once ------------ */

    const tail = (await (await api.get(`/api/runs/${run.id}`)).json()).run;
    expect(tail.log).toHaveLength(40);
    expect(tail.logMore).toBe(true);
    const seen: Line[] = [...tail.log];
    let cursor = tail.log[0].id;
    let pages = 0;
    for (;;) {
      const answer = await api.get(`/api/runs/${run.id}?before=${cursor}`);
      expect(answer.ok()).toBe(true);
      const page = (await answer.json()) as { lines: Line[]; more: boolean };
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
    expect((await api.get(`/api/runs/${run.id}?before=nope`)).status()).toBe(400);
    expect(
      (await api.get(`/api/runs/${run.id}?before=00000000-0000-4000-8000-000000000000`)).status(),
    ).toBe(404);

    /* ---- the panel: press until the first line is there -------------- */

    await page.goto(`/p/${projectId}`);
    await card(page, "A long log").first().click();
    const log = page.getByTestId("panel-run").getByTestId("panel-run-log");
    const lines = log.getByTestId("run-log-line");
    await expect(lines).toHaveCount(40);
    const earlier = log.getByTestId("run-log-earlier");
    for (const count of [140, 240, 300]) {
      await earlier.click();
      await expect(lines).toHaveCount(count);
    }
    await expect(earlier).toBeHidden();
    await expect(lines.first()).toContainText("line 001");
    const texts = await log.locator("[data-testid=run-log-line] > :last-child").allTextContents();
    expect(new Set(texts).size).toBe(300);

    /* ---- the run writes on, and the earlier lines stay --------------- */

    await api.patch(`/api/runs/${run.id}`, { log: "one more line" });
    await expect(lines).toHaveCount(301);
    await expect(lines.last()).toContainText("one more line");
    await expect(lines.first()).toContainText("line 001");

    // More than a tail's worth at once: the panel reads across the gap.
    await writeLinesNow(run.id, 60);
    await api.patch(`/api/runs/${run.id}`, { log: "after the burst" });
    await expect(lines).toHaveCount(362);
    await expect(lines.last()).toContainText("after the burst");
    await expect(lines.first()).toContainText("line 001");
    const after = await log.locator("[data-testid=run-log-line] > :last-child").allTextContents();
    expect(new Set(after).size).toBe(362);

    /* ---- the same run, over, opened from Earlier runs ---------------- */

    await api.patch(`/api/runs/${run.id}`, { status: "done", log: "finished" });
    const row = page.getByTestId("past-run").first();
    await row.click();
    const pastLog = page.getByTestId("past-run-open").getByTestId("panel-run-log");
    const pastLines = pastLog.getByTestId("run-log-line");
    await expect(pastLines).toHaveCount(40);
    const pastEarlier = pastLog.getByTestId("run-log-earlier");
    while (await pastEarlier.isVisible()) {
      const before = await pastLines.count();
      await pastEarlier.click();
      await expect(pastLines).not.toHaveCount(before);
    }
    await expect(pastLines).toHaveCount(363);
    await expect(pastLines.first()).toContainText("line 001");
  });

  test("a task with 40 runs says so and shows them all", async ({ page, request }) => {
    const { projectId, task, api } = await agentOnATask(page, request, "Run many times");
    const me = (await (await api.get("/api/agent/me")).json()).agent;
    // Forty closed runs, two to a moment, so the cursor has ties to cross.
    await inDatabase(async (client) => {
      await client.query(
        `insert into agent_runs (project_id, task_id, agent_id, goal, step, status,
                                 started_at, updated_at, beat_at, ended_at)
         select $1, $2, $3, 'goal ' || lpad(n::text, 2, '0'), 'done', 'done',
                now() - interval '2 days' + (n / 2) * interval '1 minute',
                now() - interval '1 day', now() - interval '1 day', now() - interval '1 day'
           from generate_series(1, 40) as n`,
        [projectId, task.id, me.id],
      );
    });

    const detail = (await (await api.get(`/api/tasks/${task.id}`)).json()).task;
    expect(detail.pastRuns).toHaveLength(20);
    expect(detail.pastRunsTotal).toBe(40);
    const next = await (
      await api.get(`/api/tasks/${task.id}/runs?before=${detail.pastRuns.at(-1).id}`)
    ).json();
    expect(next.runs).toHaveLength(20);
    expect(next.more).toBe(false);
    const ids = [...detail.pastRuns, ...next.runs].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(40);

    await page.goto(`/p/${projectId}`);
    await card(page, "Run many times").first().click();
    await page.getByTestId("agent-tab").click();
    await expect(page.getByTestId("past-runs-total")).toHaveText("Earlier runs · 40");
    const rows = page.getByTestId("past-run");
    await expect(rows).toHaveCount(20);
    await page.getByTestId("past-runs-more").click();
    await expect(rows).toHaveCount(40);
    await expect(page.getByTestId("past-runs-more")).toBeHidden();
    const goals = await rows.allTextContents();
    expect(new Set(goals.map((g) => g.match(/goal \d\d/)?.[0])).size).toBe(40);
  });
});

/** Lines written a moment ago, so they are the newest the run has. */
async function writeLinesNow(runId: string, count: number) {
  await inDatabase(async (client) => {
    await client.query(
      `insert into agent_run_log (run_id, text, created_at)
       select $1, 'burst ' || lpad(n::text, 2, '0'), now()
         from generate_series(1, $2::int) as n`,
      [runId, count],
    );
  });
}
