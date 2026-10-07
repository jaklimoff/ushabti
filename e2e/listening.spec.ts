import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
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
  await box.getByRole("button", { name: "Make token" }).click();
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

  test("a comment stays a comment, and offers no way to become the description", async ({
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

    await api.post(`/api/tasks/${task.id}/comments`, { body: "Queue writes offline." });

    await page.goto(`/p/${projectId}?task=${task.key}`);
    const comment = page.getByTestId("comment").filter({ hasText: "Queue writes offline." });
    await comment.hover();
    await expect(comment).toBeVisible();
    await expect(comment.getByRole("button", { name: "Use as description" })).toHaveCount(0);
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

test.describe("A line that says whom it is for", () => {
  /* A watcher decides from the line, so the line has to say it: the type on
     every value line, the person on a person line, the assignees on a new
     task. The panel reads the same line and names the person. */
  test("a value line names its type and its person, and the panel names the person", async ({
    page,
  }) => {
    await register(page, "Line Owner");
    const projectId = await createProject(page, unique("Lines"));
    await addTask(page, "Todo", "Hand it over");
    await page.getByRole("button", { name: "Close task" }).click();
    const token = await connectAgent(page, projectId, "Reis");
    const api = agentApi(page.request, token);

    const { board, task } = await taskByTitle(page.request, projectId, "Hand it over");
    const assignee = board.properties.find((p: { type: string }) => p.type === "person");
    const status = board.properties.find((p: { type: string }) => p.type === "select");
    const reis = board.members.find((m: { name: string }) => m.name === "Reis");
    const since = (await (await api.get(`/api/projects/${projectId}/activity`)).json()).now;

    const put = (propertyId: string, value: unknown) =>
      page.request.put(`/api/tasks/${task.id}/values/${propertyId}`, { data: { value } });
    expect((await put(assignee.id, reis.id)).ok()).toBeTruthy();
    expect((await put(status.id, status.options[1].id)).ok()).toBeTruthy();
    const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "Made for Reis", values: { [assignee.id]: reis.id } },
    });
    expect(made.ok()).toBeTruthy();

    type Line = { kind: string; taskKey: string; data: Record<string, unknown> };
    const { entries } = (await (
      await api.get(`/api/projects/${projectId}/activity?after=${encodeURIComponent(since)}`)
    ).json()) as { entries: Line[] };
    const values = entries.filter((e) => e.kind === "value" && e.taskKey === task.key);
    expect(values.find((e) => e.data.propertyId === assignee.id)?.data).toMatchObject({
      type: "person",
      personId: reis.id,
    });
    const drag = values.find((e) => e.data.propertyId === status.id)?.data;
    expect(drag).toMatchObject({ type: "select" });
    expect(drag).not.toHaveProperty("personId");
    const created = entries.find((e) => e.kind === "created");
    expect(created?.data.assigneeIds).toEqual([reis.id]);

    await page.goto(`/p/${projectId}?task=${task.key}`);
    await page.getByRole("tab", { name: /^Activity/ }).click();
    await expect(page.getByText("Line Owner set Assignee to Reis")).toBeVisible();
    await expect(page.getByText(reis.id)).toHaveCount(0);
  });
});

test.describe("A write of more than a page of lines", () => {
  /* One write stamps all its lines with one moment. A feed paged by the
     moment alone read the first 200 of such a burst for ever, and the
     watcher behind it stopped hearing anything at all. */

  type FeedEntry = { id: string; kind: string; createdAt: string; taskKey: string | null };

  /** Makes `count` tasks with no value in a select, and archives that column in one write. */
  async function archiveBurst(request: APIRequestContext, projectId: string, count: number) {
    const { board } = await taskByTitle(request, projectId, "Keep me");
    const select = board.properties.find((p: { type: string }) => p.type === "select");
    for (let made = 0; made < count; made += 10) {
      await Promise.all(
        Array.from({ length: Math.min(10, count - made) }, (_, i) =>
          request
            .post(`/api/projects/${projectId}/tasks`, { data: { title: `Burst ${made + i}` } })
            .then((res) => expect(res.ok()).toBeTruthy()),
        ),
      );
    }
    const since = (await (await request.get(`/api/projects/${projectId}/activity`)).json()).now;
    const res = await request.post(`/api/projects/${projectId}/archive`, {
      data: { propertyId: select.id, value: null },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).archived).toBe(count);
    return since as string;
  }

  /** A task that keeps a value in every select, so the burst leaves it alone. */
  async function keepTask(page: Page) {
    await addTask(page, "Todo", "Keep me");
    await page.getByRole("button", { name: "Close task" }).click();
  }

  async function assignTo(request: APIRequestContext, projectId: string, name: string) {
    const { board, task } = await taskByTitle(request, projectId, "Keep me");
    const assignee = board.properties.find((p: { type: string }) => p.type === "person");
    const agent = board.members.find((m: { name: string }) => m.name === name);
    const assigned = await request.put(`/api/tasks/${task.id}/values/${assignee.id}`, {
      data: { value: agent.id },
    });
    expect(assigned.ok()).toBeTruthy();
    return task.key as string;
  }

  function watch(token: string, args: string[]) {
    const harness = `node ${JSON.stringify(BOARD_MJS)} finish {key} --log heard`;
    const watcher = spawn(
      process.execPath,
      [BOARD_MJS, "watch", "--once", "--on", "assigned", "--run", harness, ...args],
      {
        env: { ...process.env, USHABTI_URL: boardUrl(), USHABTI_TOKEN: token },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const out = { text: "" };
    watcher.stdout.on("data", (chunk) => (out.text += chunk));
    watcher.stderr.on("data", (chunk) => (out.text += chunk));
    const exited = new Promise<number | null>((done) => watcher.on("exit", (code) => done(code)));
    const finished = () =>
      Promise.race([
        exited,
        new Promise<"timeout">((done) => setTimeout(() => done("timeout"), 40_000)),
      ]);
    return { watcher, out, finished };
  }

  test("a feed of 500 lines written at one moment is read whole, 200 at a time", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await register(page, "Feed Owner");
    const projectId = await createProject(page, unique("Burst"));
    await keepTask(page);
    const since = await archiveBurst(page.request, projectId, 500);

    const read: FeedEntry[] = [];
    const pages: number[] = [];
    let query = `after=${encodeURIComponent(since)}`;
    for (;;) {
      const res = await page.request.get(`/api/projects/${projectId}/activity?${query}&limit=200`);
      expect(res.ok()).toBeTruthy();
      const { entries } = (await res.json()) as { entries: FeedEntry[] };
      pages.push(entries.length);
      read.push(...entries);
      if (entries.length < 200 || pages.length > 5) break;
      const last = entries[entries.length - 1];
      query = `after=${encodeURIComponent(last.createdAt)}&afterId=${last.id}`;
    }

    expect(pages).toEqual([200, 200, 100]);
    expect(new Set(read.map((e) => e.id)).size).toBe(500);
    expect(read.every((e) => e.kind === "archive")).toBe(true);
    // One write, one moment: the moment alone could not have said where a page ended.
    expect(new Set(read.map((e) => e.createdAt)).size).toBe(1);

    const bad = await page.request.get(
      `/api/projects/${projectId}/activity?after=${encodeURIComponent(since)}&afterId=nope`,
    );
    expect(bad.status()).toBe(400);
  });

  test("after 300 cards are archived in one write, an assignment that follows wakes the watcher", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await register(page, "Burst Owner");
    const projectId = await createProject(page, unique("Deaf"));
    await keepTask(page);
    const token = await connectAgent(page, projectId, "Refiner");

    const { watcher, out, finished } = watch(token, []);
    try {
      await page.goto(`/p/${projectId}`);
      await expect(page.getByTestId("listening-agent")).toBeVisible();

      await archiveBurst(page.request, projectId, 300);
      // The watcher reads the burst before the assignment arrives.
      await page.waitForTimeout(3_000);
      const key = await assignTo(page.request, projectId, "Refiner");

      expect(await finished(), out.text).toBe(0);
      expect(out.text).toContain(`${key}: assigned`);
      expect(out.text).toContain(`${key}: done`);
    } finally {
      watcher.kill("SIGTERM");
    }
  });

  test("a watcher with an old --state file catches up instead of stopping", async ({ page }) => {
    test.setTimeout(240_000);
    await register(page, "State Owner");
    const projectId = await createProject(page, unique("Stuck"));
    await keepTask(page);
    const token = await connectAgent(page, projectId, "Refiner");
    const since = await archiveBurst(page.request, projectId, 300);

    /* What a watcher of the old release left behind: its cursor on the
       burst's moment, and the first page of the burst seen. */
    const first = (
      await (
        await page.request.get(
          `/api/projects/${projectId}/activity?after=${encodeURIComponent(since)}&limit=200`,
        )
      ).json()
    ).entries as FeedEntry[];
    expect(first).toHaveLength(200);
    const state = path.join(mkdtempSync(path.join(os.tmpdir(), "ushabti-state-")), "watch.json");
    writeFileSync(
      state,
      JSON.stringify({ projectId, cursor: first[0].createdAt, seen: first.map((e) => e.id) }),
    );

    const key = await assignTo(page.request, projectId, "Refiner");

    const { watcher, out, finished } = watch(token, ["--state", state]);
    try {
      expect(await finished(), out.text).toBe(0);
      expect(out.text).toContain(`${key}: assigned`);
      expect(out.text).toContain(`${key}: done`);
    } finally {
      watcher.kill("SIGTERM");
    }
  });
});

test.describe("An edited comment", () => {
  /* The edit writes a `comment` line of its own. Read as a new comment, it
     would wake the agent a second time for a name it already answered. */
  test("wakes a watching agent once, not again when it is edited", async ({ page }) => {
    await register(page, "Edit Owner");
    const projectId = await createProject(page, unique("EditWake"));
    await addTask(page, "Todo", "Talk to me");
    await page.getByRole("button", { name: "Close task" }).click();
    const token = await connectAgent(page, projectId, "Refiner");

    const harness = `node ${JSON.stringify(BOARD_MJS)} finish {key} --log heard`;
    const watcher = spawn(
      process.execPath,
      [BOARD_MJS, "watch", "--on", "mention", "--run", harness],
      {
        env: { ...process.env, USHABTI_URL: boardUrl(), USHABTI_TOKEN: token },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    watcher.stdout.on("data", (chunk) => (output += chunk));
    watcher.stderr.on("data", (chunk) => (output += chunk));

    try {
      await page.goto(`/p/${projectId}`);
      await expect(page.getByTestId("listening-agent")).toBeVisible();

      const { task } = await taskByTitle(page.request, projectId, "Talk to me");
      const posted = await page.request.post(`/api/tasks/${task.id}/comments`, {
        data: { body: "@Refiner have a look" },
      });
      const { comment } = await posted.json();
      await expect.poll(() => output, { timeout: 30_000 }).toContain(`${task.key}: done`);
      const wakes = () => output.split(`${task.key}: mention`).length - 1;
      expect(wakes(), output).toBe(1);

      const edited = await page.request.patch(`/api/comments/${comment.id}`, {
        data: { body: "@Refiner have a look, please" },
      });
      expect(edited.status()).toBe(200);
      // A later line proves the watcher read past the edit before we count.
      await addTask(page, "Todo", "Read after the edit");
      await page.getByRole("button", { name: "Close task" }).click();
      const after = await taskByTitle(page.request, projectId, "Read after the edit");
      await page.request.post(`/api/tasks/${after.task.id}/comments`, {
        data: { body: "@Refiner and this one" },
      });
      await expect.poll(() => output, { timeout: 30_000 }).toContain(`${after.task.key}: done`);
      expect(wakes(), output).toBe(1);
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
