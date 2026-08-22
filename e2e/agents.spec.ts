import { expect, test, type APIRequestContext } from "@playwright/test";
import { addTask, card, centreOf, createProject, dragCard, register, unique } from "./helpers";

/** The calls an agent makes, with the token in place of a session cookie. */
function agentApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    get: (path: string) => request.get(path, { headers }),
    post: (path: string, data: unknown = {}) => request.post(path, { headers, data }),
    patch: (path: string, data: unknown = {}) => request.patch(path, { headers, data }),
  };
}

test.describe("Agents on the board", () => {
  test("an agent takes a token, opens a run, and the board shows it", async ({ page, request }) => {
    await register(page, "Agent Owner");
    const projectId = await createProject(page, unique("Agents"));
    await addTask(page, "Todo", "Work for a machine");
    await page.getByRole("button", { name: "Close task" }).click();

    /* ---- the owner creates the agent and issues a token -------------- */

    await page.goto(`/p/${projectId}/settings`);
    await page.getByLabel("Name of the new agent").fill("Builder");
    await page.getByRole("button", { name: "Add agent" }).click();

    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Builder" });
    await expect(agentBox).toBeVisible();

    await agentBox.getByRole("button", { name: "Issue token" }).click();
    const secret = page.getByTestId("agent-secret").first();
    await expect(secret).toBeVisible();

    const token = ((await secret.locator("code").textContent()) ?? "").trim();
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

  test("a token only opens its own project, and a revoked one opens nothing", async ({
    page,
    request,
  }) => {
    await register(page, "Two Projects");
    const first = await createProject(page, unique("First"));
    const second = await createProject(page, unique("Second"));

    await page.goto(`/p/${first}/settings`);
    await page.getByLabel("Name of the new agent").fill("Reader");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Reader" });
    await agentBox.getByRole("button", { name: "Issue token" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").textContent()) ?? ""
    ).trim();

    const api = agentApi(request, token);
    expect((await api.get(`/api/projects/${first}/board`)).ok()).toBeTruthy();
    expect((await api.get(`/api/projects/${second}/board`)).status()).toBe(403);

    // An agent is a member, not an owner: it cannot make more of itself.
    expect((await api.post(`/api/projects/${first}/agents`, { name: "Copy" })).status()).toBe(403);

    await agentBox.getByRole("button", { name: /^Revoke the token/ }).click();
    await expect(page.getByTestId("agent-secret")).toBeHidden();
    expect((await api.get(`/api/projects/${first}/board`)).status()).toBe(401);
  });

  test("dragging a card an agent holds takes it over", async ({ page, request }) => {
    await register(page, "Drag Owner");
    const projectId = await createProject(page, unique("Drag"));
    await addTask(page, "Todo", "Held while dragged");
    await page.getByRole("button", { name: "Close task" }).click();

    await page.goto(`/p/${projectId}/settings`);
    await page.getByLabel("Name of the new agent").fill("Mover");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Mover" });
    await agentBox.getByRole("button", { name: "Issue token" }).click();
    const token = (
      (await page.getByTestId("agent-secret").first().locator("code").textContent()) ?? ""
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
});
