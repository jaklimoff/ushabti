import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  addTask,
  backdateRun,
  card,
  centreOf,
  createProject,
  dragCard,
  gotoSettings,
  register,
  unique,
} from "./helpers";

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

    await api.patch(`/api/runs/${run.id}`, { status: "paused" });
    await expect(page.getByTestId("panel-run-pending")).toBeHidden();

    /* ---- Take over ends it at once ----------------------------------- */

    await page.getByTestId("panel-run").getByRole("button", { name: "Take over" }).click();
    await expect(page.getByTestId("panel-run")).toBeHidden();
    await expect(page.getByTestId("agent-tab")).toBeHidden();
    await expect(held.getByTestId("card-run")).toBeHidden();

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

    // Pause and Stop mean nothing if the agent can write them itself.
    const { run } = await (
      await api.post(`/api/tasks/${task.id}/run`, { goal: "Do it", step: "Starting" })
    ).json();
    expect((await api.post(`/api/runs/${run.id}/control`, { control: "resume" })).status()).toBe(
      403,
    );
  });
});
