import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { addTask, card, createProject, gotoSettings, register, unique } from "./helpers";

// Playwright runs from the repository root, locally and on CI.
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

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

async function taskByTitle(request: APIRequestContext, projectId: string, title: string) {
  const board = await (await request.get(`/api/projects/${projectId}/board`)).json();
  const task = board.tasks.find((t: { title: string }) => t.title === title);
  expect(task).toBeTruthy();
  return { board, task };
}

/*
 * What needs the stream, the watcher and a harness. The feed, the waiting
 * run and the hand-over are route answers (`activity-route.test.ts`,
 * `runs-route.test.ts`), the client's own refusals `skill-check.test.ts`, and
 * what the panel and the top bar draw `AgentTab.test.tsx` and
 * `Listening.test.tsx`.
 */
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

test.describe("A write of more than a page of lines", () => {
  /* One write stamps all its lines with one moment. A feed paged by the
     moment alone read the first 200 of such a burst for ever, and the
     watcher behind it stopped hearing anything at all. */

  type FeedEntry = { id: string; kind: string; createdAt: string; taskKey: string | null };

  /** A page of the feed is 200 lines, so a burst of this many is one page and a bit. */
  const BURST = 210;

  /** The lines a watcher has read, as its `--state` file names them. */
  function readSeen(file: string): string[] {
    try {
      return (JSON.parse(readFileSync(file, "utf8")) as { seen: string[] }).seen;
    } catch {
      return [];
    }
  }

  /** A new file for a watcher's `--state`. */
  const stateFile = () =>
    path.join(mkdtempSync(path.join(os.tmpdir(), "ushabti-state-")), "watch.json");

  /** Every line the feed holds after `since`, read page by page as the watcher does. */
  async function linesAfter(request: APIRequestContext, projectId: string, since: string) {
    const lines: FeedEntry[] = [];
    let page = `after=${encodeURIComponent(since)}`;
    for (;;) {
      const { entries } = (await (
        await request.get(`/api/projects/${projectId}/activity?${page}&limit=200`)
      ).json()) as { entries: FeedEntry[] };
      lines.push(...entries);
      if (entries.length < 200) return lines;
      const last = entries[entries.length - 1];
      page = `after=${encodeURIComponent(last.createdAt)}&afterId=${last.id}`;
    }
  }

  /** Makes `count` tasks with no value in a select, and archives that column in one write. */
  async function archiveBurst(request: APIRequestContext, projectId: string, count: number) {
    const { board } = await taskByTitle(request, projectId, "Keep me");
    const select = board.properties.find((p: { type: string }) => p.type === "select");
    for (let made = 0; made < count; made += 25) {
      await Promise.all(
        Array.from({ length: Math.min(25, count - made) }, (_, i) =>
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

  test("after more than a page of cards is archived in one write, an assignment that follows wakes the watcher", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await register(page, "Burst Owner");
    const projectId = await createProject(page, unique("Deaf"));
    await keepTask(page);
    const token = await connectAgent(page, projectId, "Refiner");

    const state = stateFile();
    const { watcher, out, finished } = watch(token, ["--state", state]);
    try {
      await page.goto(`/p/${projectId}`);
      await expect(page.getByTestId("listening-agent")).toBeVisible();

      const since = await archiveBurst(page.request, projectId, BURST);
      /* The watcher reads the whole burst before the assignment arrives. Its
         state file names every line it has read. */
      const burst = (await linesAfter(page.request, projectId, since)).map((e) => e.id);
      expect(burst).toHaveLength(BURST);
      await expect
        .poll(
          () => {
            const seen = new Set(readSeen(state));
            return burst.filter((id) => !seen.has(id)).length;
          },
          { timeout: 30_000 },
        )
        .toBe(0);
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
    const since = await archiveBurst(page.request, projectId, BURST);

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
    const state = stateFile();
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
