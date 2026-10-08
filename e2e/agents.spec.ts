import { spawn } from "node:child_process";
import path from "node:path";
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
  /* The limiter counts a bad token per address, and the address is whatever
     the proxy in front says in `x-forwarded-for`. Some tests here send a token
     that no longer works, so each token takes an address of its own, made
     fresh inside the test so that a retry gets another one. Without it every
     run counts under 127.0.0.1, and a few runs in a row meet the limit. */
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "x-forwarded-for": unique("198.51.100"),
  };
  return {
    get: (path: string) => request.get(path, { headers }),
    post: (path: string, data: unknown = {}) => request.post(path, { headers, data }),
    patch: (path: string, data: unknown = {}) => request.patch(path, { headers, data }),
    put: (path: string, data: unknown = {}) => request.put(path, { headers, data }),
    del: (path: string) => request.delete(path, { headers }),
  };
}

/*
 * What needs a whole system: the first run walked through the board and the
 * shipped client, a card dragged out of an agent's hands, and a run the lease
 * closes on a reload. The route answers are `agents-route.test.ts`, the
 * heartbeat's own door `skill-beat.test.ts`, and the Agent tab and the tokens
 * in Settings `AgentTab.test.tsx` and `PeoplePanel.test.tsx`.
 */
test.describe("Agents on the board", () => {
  test(
    "an agent takes a token, opens a run, and the board shows it",
    { tag: "@smoke" },
    async ({ page, request }) => {
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

      await agentBox.getByRole("button", { name: "Make token" }).click();
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
      // The buttons and the bar go with the run. The tab stays, because the run
      // is now a record, and the row says how it ended. The row is waited for
      // first: it is what proves the panel has read the task again.
      await expect(page.getByTestId("past-run").first()).toContainText("taken over");
      await expect(page.getByTestId("panel-run")).toBeHidden();
      await expect(held.getByTestId("card-run")).toBeHidden();

      const afterTakeOver = await api.patch(`/api/runs/${run.id}`, { step: "Still going" });
      expect(afterTakeOver.status()).toBe(409);
    },
  );

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
    await agentBox.getByRole("button", { name: "Make token" }).click();
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

    /* A run the board closed is a run that is over, so the panel keeps it the
       way it keeps any other: the tab stays and the row says `lost`. What goes
       is the block a live run draws — the buttons and the scanning bar, which
       have nothing left to act on. Each line here waits for something to be
       there before it asks what is gone, because an empty panel answers
       "hidden" to every question while its read is still out. */
    await held.click();
    await page.getByTestId("agent-tab").click();
    await expect(page.getByTestId("past-run").first()).toContainText("lost");
    await expect(page.getByTestId("panel-run")).toBeHidden();
    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect(page.getByText("stopped answering")).toBeVisible();
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
    await agentBox.getByRole("button", { name: "Make token" }).click();
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
});
