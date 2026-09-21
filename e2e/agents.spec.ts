import { spawn } from "node:child_process";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  addFilter,
  addTask,
  backdateRun,
  card,
  centreOf,
  createProject,
  dragCard,
  gotoSettings,
  putFilterOnView,
  register,
  unique,
} from "./helpers";

const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

/** The shipped client, run the way an agent runs it, against this board. */
function runClient(token: string, args: string[]) {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("The tests need a baseURL.");
  const child = spawn(process.execPath, [BOARD_MJS, ...args], {
    env: { ...process.env, USHABTI_URL: base.replace(/\/$/, ""), USHABTI_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
  return { child, exited, output: () => output };
}

/** The calls an agent makes, with the token in place of a session cookie. */
function agentApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    get: (path: string) => request.get(path, { headers }),
    post: (path: string, data: unknown = {}) => request.post(path, { headers, data }),
    patch: (path: string, data: unknown = {}) => request.patch(path, { headers, data }),
    put: (path: string, data: unknown = {}) => request.put(path, { headers, data }),
    del: (path: string) => request.delete(path, { headers }),
  };
}

test.describe("Agents on the board", () => {
  test("an agent takes a token, opens a run, and the board shows it", async ({ page, request }) => {
    await register(page, "Agent Owner");
    const projectId = await createProject(page, unique("Agents"));
    await addTask(page, "Todo", "Work for a machine");
    await page.getByRole("button", { name: "Close task" }).click();

    /* ---- the owner creates the agent and issues a token -------------- */

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Builder");
    await page.getByRole("button", { name: "Add agent" }).click();

    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Builder" });
    await expect(agentBox).toBeVisible();

    await agentBox.getByRole("button", { name: "Connect" }).click();
    const secret = page.getByTestId("agent-secret").first();
    await expect(secret).toBeVisible();

    const token = ((await secret.locator("code").first().textContent()) ?? "").trim();
    expect(token).toMatch(/^ush_/);

    /* ---- the agent signs in with it ---------------------------------- */

    const api = agentApi(request, token);

    const me = await api.get("/api/agent/me");
    expect(me.ok()).toBeTruthy();
    const identity = await me.json();
    expect(identity.agent.name).toBe("Builder");
    expect(identity.project.id).toBe(projectId);

    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const task = board.tasks.find((t: { title: string }) => t.title === "Work for a machine");
    expect(task).toBeTruthy();

    const started = await api.post(`/api/tasks/${task.id}/run`, {
      goal: "Do the work",
      step: "Reading the task",
      steps: ["Read the task", "Write the change", "Run the tests"],
    });
    expect(started.status()).toBe(201);
    const { run } = await started.json();

    /* ---- a second run on the same task has to wait ------------------- */

    const second = await api.post(`/api/tasks/${task.id}/run`, { goal: "Me too" });
    expect(second.status()).toBe(409);

    /* ---- the card carries the signal --------------------------------- */

    await page.goto(`/p/${projectId}`);
    const held = card(page, "Work for a machine").first();
    await expect(held.getByTestId("card-run-step")).toHaveText("Reading the task");
    await expect(held.getByTestId("card-run")).toContainText("Builder");

    /* ---- the agent reports, and the card follows --------------------- */

    await api.patch(`/api/runs/${run.id}`, {
      step: "Writing the change",
      stepIndex: 1,
      log: "edited queue.ts",
    });

    await expect(held.getByTestId("card-run-step")).toHaveText("Writing the change");

    /* ---- the panel shows the plan and the log ------------------------ */

    await held.click();
    // The run has a tab of its own, and the dot on it says the agent is live.
    await page.getByTestId("agent-tab").click();
    const panel = page.getByTestId("panel-run");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Builder")).toBeVisible();
    await expect(panel.getByTestId("agent-live-ring")).toBeVisible();
    // The plan stays in the panel, where there is room to read it.
    await expect(panel.getByText("Write the change")).toBeVisible();
    await expect(panel.getByText("2 / 3")).toBeVisible();
    await expect(page.getByTestId("panel-run-log").getByText("edited queue.ts")).toBeVisible();

    /* ---- Pause is a request the agent reads -------------------------- */

    await panel.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByTestId("panel-run-pending")).toContainText("pause");

    const answer = await (await api.patch(`/api/runs/${run.id}`, { step: "Waiting" })).json();
    expect(answer.control).toBe("pause");

    /* ---- and the shipped client answers it, then waits for Resume ---- */

    const pausing = runClient(token, ["pause", task.key, "--every", "1", "--for", "1"]);
    try {
      await expect(page.getByTestId("panel-run-pending")).toBeHidden();
      await expect(panel).toContainText("paused");
      await expect(held.getByTestId("card-run-step")).toHaveText("Paused");

      await panel.getByRole("button", { name: "Resume" }).click();
      const code = await Promise.race([
        pausing.exited,
        new Promise<"timeout">((done) => setTimeout(() => done("timeout"), 20_000)),
      ]);
      expect(code, pausing.output()).toBe(0);
      expect(pausing.output()).toContain(`${task.key}: resumed`);
    } finally {
      pausing.child.kill("SIGTERM");
    }
    await expect(page.getByTestId("panel-run-pending")).toBeHidden();
    await expect(panel.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(held.getByTestId("card-run-step")).toHaveText("Resumed");

    /* ---- Take over ends it at once ----------------------------------- */

    await page.getByTestId("panel-run").getByRole("button", { name: "Take over" }).click();
    await expect(page.getByTestId("panel-run")).toBeHidden();
    await expect(held.getByTestId("card-run")).toBeHidden();
    // The buttons and the bar go with the run. The tab stays, because the run
    // is now a record, and the row says how it ended.
    await expect(page.getByTestId("agent-tab")).toBeVisible();
    await expect(page.getByTestId("past-run").first()).toContainText("taken over");

    const afterTakeOver = await api.patch(`/api/runs/${run.id}`, { step: "Still going" });
    expect(afterTakeOver.status()).toBe(409);
  });

  test("a beat says the agent is alive and says nothing else", async ({ page, request }) => {
    await register(page, "Beat Owner");
    const projectId = await createProject(page, unique("Beat"));
    await addTask(page, "Todo", "Held through a long build");
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Beater");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Beater" });
    await agentBox.getByRole("button", { name: "Connect" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
    ).trim();

    const api = agentApi(request, token);
    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const task = board.tasks.find(
      (t: { title: string }) => t.title === "Held through a long build",
    );
    const { run } = await (
      await api.post(`/api/tasks/${task.id}/run`, { goal: "Build it", step: "Running the build" })
    ).json();

    const before = (await (await api.get(`/api/runs/${run.id}`)).json()).run;

    const beat = await api.patch(`/api/runs/${run.id}`, { beat: true });
    expect(beat.ok()).toBeTruthy();

    const after = (await (await api.get(`/api/runs/${run.id}`)).json()).run;

    // The one thing a beat may move.
    expect(new Date(after.beatAt).getTime()).toBeGreaterThan(new Date(before.beatAt).getTime());

    // And everything it may not. The card is a report of work, and a timer
    // does no work: it must not be able to look like progress.
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.step).toBe("Running the build");
    expect(after.log).toHaveLength(before.log.length);

    await page.goto(`/p/${projectId}`);
    const held = card(page, "Held through a long build").first();
    await expect(held.getByTestId("card-run-step")).toHaveText("Running the build");

    // A run that is over answers a beat the same way it answers a report.
    await api.patch(`/api/runs/${run.id}`, { status: "done" });
    expect((await api.patch(`/api/runs/${run.id}`, { beat: true })).status()).toBe(409);
  });

  test("a run that stops answering goes quiet, then silent, then closes itself", async ({
    page,
    request,
  }) => {
    await register(page, "Lease Owner");
    const projectId = await createProject(page, unique("Lease"));
    await addTask(page, "Todo", "Left behind by a killed agent");
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Ghost");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Ghost" });
    await agentBox.getByRole("button", { name: "Connect" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
    ).trim();

    const api = agentApi(request, token);
    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const task = board.tasks.find(
      (t: { title: string }) => t.title === "Left behind by a killed agent",
    );
    const { run } = await (
      await api.post(`/api/tasks/${task.id}/run`, { goal: "Never come back", step: "Working" })
    ).json();

    await page.goto(`/p/${projectId}`);
    const held = card(page, "Left behind by a killed agent").first();
    await expect(held.getByTestId("card-run")).toHaveAttribute("data-life", "reporting");

    /* ---- nothing for ten minutes: the card stops claiming progress --- */

    await backdateRun(run.id, 10);
    await page.reload();
    await expect(held.getByTestId("card-run")).toHaveAttribute("data-life", "silent");
    await expect(held.getByTestId("card-run-time")).toContainText("silent");

    /* ---- a beat softens the word and moves nothing else -------------- */

    await api.patch(`/api/runs/${run.id}`, { beat: true });
    await page.reload();
    await expect(held.getByTestId("card-run")).toHaveAttribute("data-life", "quiet");
    // Alive, but the line is still the last thing the agent actually said.
    await expect(held.getByTestId("card-run-step")).toHaveText("Working");

    /* ---- past the lease: the board takes the card back --------------- */

    await backdateRun(run.id, 40);
    // A beat cannot buy time. The lease counts reports, and there are none.
    await api.patch(`/api/runs/${run.id}`, { beat: true });

    await page.reload();
    await expect(held.getByTestId("card-run")).toBeHidden();

    // The run is over, so the agent's next word is refused like any other.
    expect((await api.patch(`/api/runs/${run.id}`, { step: "Back!" })).status()).toBe(409);

    await held.click();
    await expect(page.getByTestId("agent-tab")).toBeHidden();
    await page.getByRole("button", { name: /^Activity/ }).click();
    await expect(page.getByText("stopped answering")).toBeVisible();
  });

  test("a token only opens its own project, and a revoked one opens nothing", async ({
    page,
    request,
  }) => {
    await register(page, "Two Projects");
    const first = await createProject(page, unique("First"));
    const second = await createProject(page, unique("Second"));

    await gotoSettings(page, first, "people");
    await page.getByLabel("Name of the new agent").fill("Reader");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Reader" });
    await agentBox.getByRole("button", { name: "Connect" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
    ).trim();

    const api = agentApi(request, token);
    expect((await api.get(`/api/projects/${first}/board`)).ok()).toBeTruthy();
    expect((await api.get(`/api/projects/${second}/board`)).status()).toBe(403);

    // An agent is a member, not an owner: it cannot make more of itself.
    expect((await api.post(`/api/projects/${first}/agents`, { name: "Copy" })).status()).toBe(403);

    await agentBox.getByRole("button", { name: /^Revoke the token/ }).click();
    await page.getByRole("button", { name: "Yes, revoke" }).click();
    await expect(page.getByTestId("agent-secret")).toBeHidden();
    expect((await api.get(`/api/projects/${first}/board`)).status()).toBe(401);
  });

  /*
   * A lens is one person's screen. An agent works from the board the team
   * shares, so it never reads one and never writes one — which is also what
   * keeps a token that got loose from hiding the work from everybody.
   */
  test("an agent reads the view's filters and never a person's own", async ({ page, request }) => {
    await register(page, "Lens Owner");
    const projectId = await createProject(page, unique("AgentLens"));

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Looker");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Looker" });
    await agentBox.getByRole("button", { name: "Connect" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
    ).trim();
    const api = agentApi(request, token);

    await page.goto(`/p/${projectId}`);
    await addTask(page, "Todo", "Work for a machine");
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.getByRole("button", { name: "Close task" }).click();
    await addFilter(page, "Priority", "Urgent");

    // The person's board is narrowed. The agent's is not.
    const before = await (await api.get(`/api/projects/${projectId}/board`)).json();
    for (const view of before.views) {
      expect(view.filters.rules).toEqual([]);
      expect(view.lens.rules).toEqual([]);
    }

    const viewId = before.views[0].id;
    expect((await api.put(`/api/views/${viewId}/lens`, { filters: { rules: [] } })).status()).toBe(
      403,
    );
    expect((await api.post(`/api/views/${viewId}/lens/promote`)).status()).toBe(403);

    // Once a person puts the rules on the view, they are the board's own.
    await putFilterOnView(page);
    const after = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const view = after.views.find((v: { id: string }) => v.id === viewId);
    expect(view.filters.rules).toHaveLength(1);
    expect(view.lens.rules).toEqual([]);
  });

  test("dragging a card an agent holds takes it over", async ({ page, request }) => {
    await register(page, "Drag Owner");
    const projectId = await createProject(page, unique("Drag"));
    await addTask(page, "Todo", "Held while dragged");
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Mover");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Mover" });
    await agentBox.getByRole("button", { name: "Connect" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
    ).trim();

    const api = agentApi(request, token);
    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const task = board.tasks.find((t: { title: string }) => t.title === "Held while dragged");
    const { run } = await (
      await api.post(`/api/tasks/${task.id}/run`, { goal: "Hold it", step: "Holding" })
    ).json();

    await page.goto(`/p/${projectId}`);
    const held = card(page, "Held while dragged").first();
    await expect(held.getByTestId("card-run")).toBeVisible();

    await dragCard(page, "Held while dragged", await centreOf(page, "In Progress"));

    await expect(page.getByTestId("card-run")).toBeHidden();
    const afterDrag = await api.patch(`/api/runs/${run.id}`, { step: "Still going" });
    expect(afterDrag.status()).toBe(409);
  });

  test("a run that is over can still be read on the task", async ({ page, request }) => {
    await register(page, "History Owner");
    const projectId = await createProject(page, unique("History"));
    await addTask(page, "Todo", "Worked on yesterday");
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Historian");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Historian" });
    await agentBox.getByRole("button", { name: "Connect" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
    ).trim();

    const api = agentApi(request, token);
    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const task = board.tasks.find((t: { title: string }) => t.title === "Worked on yesterday");

    /* ---- one run, from start to finish ------------------------------- */

    const { run } = await (
      await api.post(`/api/tasks/${task.id}/run`, {
        goal: "Write the queue tests",
        step: "Reading the queue module",
        steps: ["Read the queue module", "Write the tests"],
      })
    ).json();
    await api.patch(`/api/runs/${run.id}`, {
      step: "Writing the tests",
      stepIndex: 1,
      log: "wrote tests/queue.spec.ts",
    });
    await api.patch(`/api/runs/${run.id}`, { status: "done", log: "opened PR #124" });

    /* ---- the card says nothing, and the tab holds the record --------- */

    await page.goto(`/p/${projectId}`);
    const done = card(page, "Worked on yesterday").first();
    await expect(done.getByTestId("card-run")).toBeHidden();

    await done.click();
    const tab = page.getByTestId("agent-tab");
    await expect(tab).toBeVisible();
    // No count beside the word, and nothing pulsing: nobody is working.
    await expect(tab).toHaveText("Agent");
    await tab.click();

    await expect(page.getByTestId("panel-run")).toBeHidden();
    const row = page.getByTestId("past-run").first();
    await expect(row).toContainText("Historian");
    await expect(row).toContainText("finished");
    await expect(row).toContainText("Write the queue tests");

    /* ---- pressing it opens the plan and the log as they were left ---- */

    await expect(page.getByTestId("past-run-open")).toBeHidden();
    await row.click();
    const opened = page.getByTestId("past-run-open");
    await expect(opened).toBeVisible();
    await expect(opened).toContainText("Read the queue module");
    await expect(opened.getByText("opened PR #124")).toBeVisible();
    await expect(opened.getByText("wrote tests/queue.spec.ts")).toBeVisible();

    // One row open at a time, and pressing it again closes it.
    await row.click();
    await expect(page.getByTestId("past-run-open")).toBeHidden();

    /* ---- and an agent reads the same list off the task --------------- */

    const detail = await (await api.get(`/api/tasks/${task.id}`)).json();
    expect(detail.task.run).toBeNull();
    expect(detail.task.pastRuns).toHaveLength(1);
    expect(detail.task.pastRuns[0].status).toBe("done");
    expect(detail.task.pastRuns[0].goal).toBe("Write the queue tests");
    expect(detail.task.pastRuns[0].agent.name).toBe("Historian");
  });

  test("an agent may write the board but not take it apart", async ({ page, request }) => {
    await register(page, "Careful Owner");
    const projectId = await createProject(page, unique("Limits"));
    await addTask(page, "Todo", "The agent works on this");
    await page.getByRole("button", { name: "Close task" }).click();

    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Builder");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Builder" });
    await agentBox.getByRole("button", { name: "Connect" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
    ).trim();

    const api = agentApi(request, token);
    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const task = board.tasks.find((t: { title: string }) => t.title === "The agent works on this");

    // Content is shared: it writes values and comments like anybody else.
    const status = board.properties.find((p: { name: string }) => p.name === "Status");
    const ready = status.options.find((o: { name: string }) => o.name === "Ready");
    const wrote = await api.put(`/api/tasks/${task.id}/values/${status.id}`, { value: ready.id });
    expect(wrote.ok()).toBeTruthy();
    expect((await api.post(`/api/tasks/${task.id}/comments`, { body: "On it." })).status()).toBe(
      201,
    );

    // Structure is the owner's, and only a person's.
    const spare = board.properties.find((p: { name: string }) => p.name === "Estimate");
    expect((await api.del(`/api/properties/${spare.id}`)).status()).toBe(403);
    const extraView = board.views.find((v: { isDefault: boolean }) => !v.isDefault);
    expect((await api.del(`/api/views/${extraView.id}`)).status()).toBe(403);
    expect((await api.del(`/api/options/${ready.id}`)).status()).toBe(403);

    // A filter says what everybody on this board can see. An agent that lost
    // its token would otherwise hide the work from the people doing it.
    const hide = await api.patch(`/api/views/${extraView.id}`, {
      filters: { rules: [{ propertyId: status.id, op: "is", values: [ready.id] }] },
    });
    expect(hide.status()).toBe(403);

    // Pause and Stop mean nothing if the agent can write them itself.
    const { run } = await (
      await api.post(`/api/tasks/${task.id}/run`, { goal: "Do it", step: "Starting" })
    ).json();
    expect((await api.post(`/api/runs/${run.id}/control`, { control: "resume" })).status()).toBe(
      403,
    );
  });
});
