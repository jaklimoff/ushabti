import { spawn } from "node:child_process";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  addTask,
  backdateRun,
  card,
  createProject,
  gotoSettings,
  register,
  unique,
} from "./helpers";

// Playwright runs from the repository root, locally and on CI.
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

/** The calls an agent makes, with the token in place of a session cookie. */
function agentApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    get: (url: string) => request.get(url, { headers }),
    post: (url: string, data: unknown = {}) => request.post(url, { headers, data }),
    patch: (url: string, data: unknown = {}) => request.patch(url, { headers, data }),
  };
}

/** Makes an agent in Settings -> People and reads its token off the page. */
async function connectAgent(page: Page, projectId: string, name: string): Promise<string> {
  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill(name);
  await page.getByRole("button", { name: "Add agent" }).click();
  const box = page.getByTestId("agent-box").filter({ hasText: name });
  await box.getByRole("button", { name: "Connect" }).click();
  const token = (
    (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
  ).trim();
  expect(token).toMatch(/^ush_/);
  return token;
}

function boardUrl(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("The tests need a baseURL.");
  return base.replace(/\/$/, "");
}

async function taskByTitle(request: APIRequestContext, projectId: string, title: string) {
  const board = await (await request.get(`/api/projects/${projectId}/board`)).json();
  const task = board.tasks.find((t: { title: string }) => t.title === title);
  expect(task).toBeTruthy();
  return { board, task };
}

test.describe("Agents that wait for work", () => {
  test("an agent holding the stream is listening, and stops when it lets go", async ({ page }) => {
    await register(page, "Presence Owner");
    const projectId = await createProject(page, unique("Presence"));
    const token = await connectAgent(page, projectId, "Listener");

    await page.goto(`/p/${projectId}`);
    // Away draws nothing: an idle board says nothing about machines.
    await expect(page.getByTestId("listening-agents")).toBeHidden();

    const socket = new AbortController();
    const stream = await fetch(`${boardUrl()}/api/projects/${projectId}/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: socket.signal,
    });
    expect(stream.ok).toBeTruthy();

    try {
      await expect(
        page.getByTestId("listening-agent").and(page.locator('[data-name="Listener"]')),
      ).toBeVisible();

      await gotoSettings(page, projectId, "people");
      await expect(page.getByText("listening now")).toBeVisible();

      await page.goto(`/p/${projectId}`);
      await expect(page.getByTestId("listening-agent")).toBeVisible();
    } finally {
      socket.abort();
    }

    // A closed socket answers at once. The lease is for a crash.
    await expect(page.getByTestId("listening-agents")).toBeHidden();
  });

  test("a waiting run shows its question, keeps its card, and hears the answer", async ({
    page,
    request,
  }) => {
    await register(page, "Waiting Owner");
    const projectId = await createProject(page, unique("Waiting"));
    await addTask(page, "Todo", "Make the queue retry");
    await page.getByRole("button", { name: "Close task" }).click();
    const token = await connectAgent(page, projectId, "Asker");
    const api = agentApi(request, token);

    const { task } = await taskByTitle(page.request, projectId, "Make the queue retry");
    const since = (await (await api.get(`/api/projects/${projectId}/activity`)).json()).now;

    const { run } = await (
      await api.post(`/api/tasks/${task.id}/run`, { goal: "Refine it", step: "Reading" })
    ).json();
    await api.post(`/api/tasks/${task.id}/comments`, { body: "Which service owns the queue?" });
    const asked = await api.patch(`/api/runs/${run.id}`, {
      status: "waiting",
      step: "Which service owns the queue?",
    });
    expect(asked.ok()).toBeTruthy();

    await page.goto(`/p/${projectId}`);
    const held = card(page, "Make the queue retry").first();
    await expect(held.getByTestId("card-run-step")).toHaveText("Which service owns the queue?");
    await expect(held.getByTestId("card-run-time")).toContainText("waiting");

    /* ---- the panel says how to answer, and offers nothing that nobody
            would read ------------------------------------------------- */

    await held.click();
    await page.getByTestId("agent-tab").click();
    const panel = page.getByTestId("panel-run");
    await expect(page.getByTestId("panel-run-waiting")).toContainText("Answer it in a comment");
    await expect(panel.getByRole("button", { name: "Pause" })).toBeHidden();
    await expect(panel.getByRole("button", { name: "Stop" })).toBeHidden();
    await expect(panel.getByRole("button", { name: "Take over" })).toBeVisible();

    await page.getByRole("button", { name: /^Comments/ }).click();
    const composer = page.getByPlaceholder("Answer Asker…");
    await composer.fill("The billing service.");
    // The words are in the box before they are on the server, so wait for
    // the write itself before reading the feed.
    const posted = page.waitForResponse(
      (res) => res.url().endsWith(`/api/tasks/${task.id}/comments`) && res.status() === 201,
    );
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await posted;

    /* ---- the feed carries the answer, and who gave it ---------------- */

    const feed = await (
      await api.get(`/api/projects/${projectId}/activity?after=${encodeURIComponent(since)}`)
    ).json();
    const answer = feed.entries.find(
      (e: { kind: string; actor: { kind: string } | null }) =>
        e.kind === "comment" && e.actor?.kind === "human",
    );
    expect(answer).toBeTruthy();
    expect(answer.taskKey).toBe(task.key);
    expect(answer.data.commentId).toBeTruthy();

    /* ---- silence is the point of waiting, so the lease leaves it ----- */

    await backdateRun(run.id, 45);
    await page.reload();
    await expect(held.getByTestId("card-run-step")).toHaveText("Which service owns the queue?");

    const resumed = await api.patch(`/api/runs/${run.id}`, {
      status: "running",
      step: "Reading the answer",
    });
    expect(resumed.ok()).toBeTruthy();
  });

  test("a comment becomes the description, and asks before it replaces one", async ({
    page,
    request,
  }) => {
    await register(page, "Draft Owner");
    const projectId = await createProject(page, unique("Draft"));
    await addTask(page, "Todo", "Offline queue");
    await page.getByRole("button", { name: "Close task" }).click();
    const token = await connectAgent(page, projectId, "Drafter");
    const api = agentApi(request, token);
    const { task } = await taskByTitle(page.request, projectId, "Offline queue");

    await api.post(`/api/tasks/${task.id}/comments`, { body: "Queue **writes** offline." });

    await page.goto(`/p/${projectId}?task=${task.key}`);
    const comment = page.getByTestId("comment").filter({ hasText: "Queue writes offline." });

    // Nothing is there to lose, so nothing is asked.
    await comment.hover();
    await comment.getByRole("button", { name: "Use as description" }).click();
    await expect(page.getByTestId("markdown").locator("strong")).toHaveText("writes");
    await expect(comment.getByRole("button", { name: "Use as description" })).toBeHidden();

    await api.post(`/api/tasks/${task.id}/comments`, { body: "Queue retries five times." });
    await page.reload();
    const second = page.getByTestId("comment").filter({ hasText: "Queue retries five times." });
    await second.hover();
    await second.getByRole("button", { name: "Use as description" }).click();

    // Three words are there, and the question counts them.
    const question = second.getByRole("alertdialog");
    await expect(question).toContainText("Its 3 words go.");
    await question.getByRole("button", { name: "Yes, replace" }).click();
    await expect(page.getByTestId("markdown").first()).toHaveText("Queue retries five times.");
  });

  test("the watcher claims an assigned task and runs the harness for it", async ({ page }) => {
    await register(page, "Watch Owner");
    const projectId = await createProject(page, unique("Watch"));
    await addTask(page, "Todo", "Refine me");
    await page.getByRole("button", { name: "Close task" }).click();
    const token = await connectAgent(page, projectId, "Refiner");

    /* A harness that does what a model would, in two commands. The key is
       filled in quoted, as one argument, which is what the shell needs. */
    const harness =
      `node ${JSON.stringify(BOARD_MJS)} comment {key} "Refined by the watcher" && ` +
      `node ${JSON.stringify(BOARD_MJS)} finish {key} --log refined`;

    const watcher = spawn(
      process.execPath,
      [BOARD_MJS, "watch", "--once", "--on", "assigned", "--run", harness],
      {
        env: { ...process.env, USHABTI_URL: boardUrl(), USHABTI_TOKEN: token },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    watcher.stdout.on("data", (chunk) => (output += chunk));
    watcher.stderr.on("data", (chunk) => (output += chunk));
    const exited = new Promise<number | null>((done) => watcher.on("exit", (code) => done(code)));

    try {
      await page.goto(`/p/${projectId}`);
      await expect(page.getByTestId("listening-agent")).toBeVisible();

      // A person assigns the task to the agent, the way a field would.
      const { board, task } = await taskByTitle(page.request, projectId, "Refine me");
      const assignee = board.properties.find((p: { type: string }) => p.type === "person");
      const refiner = board.members.find((m: { name: string }) => m.name === "Refiner");
      const assigned = await page.request.put(`/api/tasks/${task.id}/values/${assignee.id}`, {
        data: { value: refiner.id },
      });
      expect(assigned.ok()).toBeTruthy();

      const code = await Promise.race([
        exited,
        new Promise<"timeout">((done) => setTimeout(() => done("timeout"), 40_000)),
      ]);
      expect(code, output).toBe(0);
      expect(output).toContain(`${task.key}: assigned`);
      expect(output).toContain(`${task.key}: done`);

      const detail = (await (await page.request.get(`/api/tasks/${task.id}`)).json()).task;
      expect(detail.comments.map((c: { body: string }) => c.body)).toContain(
        "Refined by the watcher",
      );
      // The harness closed its own run, and the card is quiet again.
      expect(detail.run).toBeNull();
      await expect(card(page, "Refine me").first().getByTestId("card-run")).toBeHidden();
    } finally {
      watcher.kill("SIGTERM");
    }
  });
});
