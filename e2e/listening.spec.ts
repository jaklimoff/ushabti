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

/** One board.mjs command, run the way an agent runs it. */
function runBoard(token: string, args: string[]): Promise<{ code: number | null; output: string }> {
  const child = spawn(process.execPath, [BOARD_MJS, ...args], {
    env: { ...process.env, USHABTI_URL: boardUrl(), USHABTI_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  return new Promise((done) => child.on("exit", (code) => done({ code, output })));
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

  test("a listening agent says its name on hover and on focus", async ({ page, browser }) => {
    await register(page, "Tip Owner");
    const projectId = await createProject(page, unique("Tip"));
    const token = await connectAgent(page, projectId, "Refiner");

    const socket = new AbortController();
    const stream = await fetch(`${boardUrl()}/api/projects/${projectId}/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: socket.signal,
    });
    expect(stream.ok).toBeTruthy();

    try {
      await page.goto(`/p/${projectId}`);
      // A screen reader hears the name, and the face draws no native title.
      const agent = page.getByRole("img", { name: "Refiner is listening" });
      await expect(agent).toBeVisible();
      await expect(agent.locator("[title]")).toHaveCount(0);

      const tip = agent.getByTestId("listening-tip");
      await expect(tip).toBeHidden();
      await agent.hover();
      await expect(tip).toBeVisible({ timeout: 200 });
      await expect(tip).toContainText("Refiner");
      await expect(tip).toContainText("Listening. It hears a new task at once.");

      await page.mouse.move(0, 400);
      await expect(tip).toBeHidden();
      // A click gives focus too, and the tip must still go with the pointer.
      await agent.click();
      await expect(tip).toBeVisible();
      await page.mouse.move(0, 400);
      await expect(tip).toBeHidden();
      await page.getByTestId("search-box").focus();
      await page.keyboard.press("Tab");
      await expect(agent).toBeFocused();
      await expect(tip).toBeVisible();
      await page.getByTestId("search-box").focus();

      // The tip stays in the window at either end of the bar: near the
      // right on a wide screen, near the left on a phone.
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 700 });
        await agent.hover();
        await expect(tip).toBeVisible();
        const box = await tip.boundingBox();
        expect(box).toBeTruthy();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await page.mouse.move(0, 400);
      }

      // A phone has no hover, so a tap is how it asks.
      const phone = await browser.newContext({
        storageState: await page.context().storageState(),
        viewport: { width: 375, height: 700 },
        hasTouch: true,
        isMobile: true,
      });
      try {
        const small = await phone.newPage();
        await small.goto(`/p/${projectId}`);
        expect(await small.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
        const face = small.getByRole("img", { name: "Refiner is listening" });
        const smallTip = face.getByTestId("listening-tip");
        await expect(smallTip).toBeHidden();
        await face.tap();
        await expect(smallTip).toBeVisible();
      } finally {
        await phone.close();
      }
    } finally {
      socket.abort();
    }
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

    await page.getByRole("tab", { name: /^Comments/ }).click();
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

  test("a run hands the task on, and the next claim closes it", async ({ page, request }) => {
    await register(page, "Hand-over Owner");
    const projectId = await createProject(page, unique("Hand-over"));
    await addTask(page, "Todo", "Make the queue retry");
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "Todo", "Ship the docs");
    await page.getByRole("button", { name: "Close task" }).click();

    const builder = await connectAgent(page, projectId, "Builder");
    const reviewer = await connectAgent(page, projectId, "Reviewer");
    const { task } = await taskByTitle(page.request, projectId, "Make the queue retry");
    const { task: second } = await taskByTitle(page.request, projectId, "Ship the docs");

    /* ---- an agent ends its session by handing the task on ------------ */

    for (const key of [task.key, second.key]) {
      const claimed = await runBoard(builder, ["claim", key, "--goal", "Open the pull request"]);
      expect(claimed.code, claimed.output).toBe(0);
    }
    /* ---- a hand-over to nobody is refused at both doors -------------- */

    const api = agentApi(request, builder);
    const empty = await runBoard(builder, ["finish", task.key, "--to", ""]);
    expect(empty.code, empty.output).not.toBe(0);
    expect(empty.output).toContain("Give who has the task");

    // `--to` with the next flag behind it reads as the word "true", which
    // would otherwise put "Waiting for true" on somebody's board.
    const flagged = await runBoard(builder, ["finish", task.key, "--to", "--log", "x"]);
    expect(flagged.code, flagged.output).not.toBe(0);
    expect(flagged.output).toContain("Give who has the task");

    const { task: working } = await (await api.get(`/api/tasks/${task.id}`)).json();
    const bare = await api.patch(`/api/runs/${working.run.id}`, { status: "handed_over" });
    expect(bare.status()).toBe(400);
    expect((await bare.json()).error).toContain("who has the task");
    expect(working.run.status).toBe("running");

    const handed = await runBoard(builder, ["finish", task.key, "--to", "review"]);
    expect(handed.code, handed.output).toBe(0);
    expect(handed.output).toContain("waiting for review");
    await runBoard(builder, ["finish", second.key, "--to", "review"]);

    /* ---- the card says who has it, instead of going quiet ------------ */

    await page.goto(`/p/${projectId}`);
    const held = card(page, "Make the queue retry").first();
    await expect(held.getByTestId("card-run-step")).toHaveText("Waiting for review");
    await expect(held.getByTestId("card-run-time")).toContainText("waiting");

    await held.click();
    await page.getByTestId("agent-tab").click();
    const panel = page.getByTestId("panel-run");
    await expect(page.getByTestId("panel-run-handed-over")).toContainText(
      "Builder handed the task to review",
    );
    await expect(panel.getByRole("button", { name: "Pause" })).toBeHidden();
    await expect(panel.getByRole("button", { name: "Stop" })).toBeHidden();
    await expect(panel.getByRole("button", { name: "Take over" })).toBeVisible();
    await page.getByRole("button", { name: "Close task" }).click();

    /* ---- it stopped on purpose, so the lease leaves it alone --------- */

    const { runs } = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const handOver = runs.find((r: { taskId: string }) => r.taskId === task.id);
    expect(handOver.status).toBe("handed_over");
    await backdateRun(handOver.id, 45);
    await page.reload();
    await expect(held.getByTestId("card-run-step")).toHaveText("Waiting for review");

    /* ---- the next agent claims: one run closes, the next opens ------- */

    const picked = await runBoard(reviewer, ["claim", task.key, "--goal", "Review the branch"]);
    expect(picked.code, picked.output).toBe(0);

    const detail = await (
      await request.get(`/api/tasks/${task.id}`, {
        headers: { Authorization: `Bearer ${reviewer}` },
      })
    ).json();
    expect(detail.task.run.agent.name).toBe("Reviewer");
    expect(detail.task.pastRuns[0].agent.name).toBe("Builder");
    expect(detail.task.pastRuns[0].status).toBe("done");

    await page.reload();
    await expect(held.getByTestId("card-run")).toContainText("Reviewer");

    /* ---- and Take over still ends one, as it ends any open run ------- */

    await card(page, "Ship the docs").first().click();
    await page.getByTestId("agent-tab").click();
    await page.getByRole("button", { name: "Take over" }).click();
    await expect(page.getByTestId("panel-run")).toBeHidden();
    await expect(card(page, "Ship the docs").first().getByTestId("card-run")).toBeHidden();
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

test.describe("An agent's checklist", () => {
  test("board.mjs adds an item, ticks the one its words name, and refuses to guess or to take an empty term", async ({
    page,
  }) => {
    await register(page, "Checklist Owner");
    const projectId = await createProject(page, unique("Checklist"));
    await addTask(page, "Todo", "Make the queue retry");
    await page.getByRole("button", { name: "Close task" }).click();
    const token = await connectAgent(page, projectId, "Ticker");
    const { task } = await taskByTitle(page.request, projectId, "Make the queue retry");

    for (const text of ["A failed send retries five times", "A failed send gives up"]) {
      const added = await runBoard(token, ["check", task.key, text]);
      expect(added.code, added.output).toBe(0);
    }

    /** What the board holds, so the tick is read back through the API. */
    const state = async () => {
      const detail = (await (await page.request.get(`/api/tasks/${task.id}`)).json()).task;
      return Object.fromEntries(
        detail.checklist.map((i: { text: string; done: boolean }) => [i.text, i.done]),
      );
    };

    // The whole text is not needed — one part that fits only one item is.
    const ticked = await runBoard(token, ["check", task.key, "retries five", "--done"]);
    expect(ticked.code, ticked.output).toBe(0);
    expect(await state()).toEqual({
      "A failed send retries five times": true,
      "A failed send gives up": false,
    });

    // Both items carry these words, so they name neither, and nothing moves.
    const several = await runBoard(token, ["check", task.key, "A failed send", "--done"]);
    expect(several.code).toBe(1);
    expect(several.output).toContain("matches 2 items");
    const none = await runBoard(token, ["check", task.key, "the disk is full", "--done"]);
    expect(none.code).toBe(1);
    expect(none.output).toContain("A failed send gives up");

    const back = await runBoard(token, ["check", task.key, "retries five", "--undone"]);
    expect(back.code, back.output).toBe(0);
    expect(await state()).toEqual({
      "A failed send retries five times": false,
      "A failed send gives up": false,
    });

    // A switch takes no value, so the flag may stand before the item as well.
    const flagFirst = await runBoard(token, ["check", task.key, "--done", "gives up"]);
    expect(flagFirst.code, flagFirst.output).toBe(0);
    expect(await state()).toEqual({
      "A failed send retries five times": false,
      "A failed send gives up": true,
    });

    // Nothing is inside every item, so a term of only spaces would tick
    // whatever it found. It is refused like a missing one.
    const empty = await runBoard(token, ["check", task.key, " ", "--done"]);
    expect(empty.code).toBe(1);
    expect(empty.output).toContain("Give the item");
    expect(await state()).toEqual({
      "A failed send retries five times": false,
      "A failed send gives up": true,
    });
  });
});
