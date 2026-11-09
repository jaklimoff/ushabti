import { spawn } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createProject, register, unique } from "./helpers";

/*
 * `board.mjs watch --view`: an agent takes only the work a view shows. A task
 * it is given outside the view waits, says so once, and starts by itself when
 * the view shows it. The view's queue is the server's own answer, so these
 * run the shipped client against the real route.
 */

// Playwright runs from the repository root, locally and on CI.
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");
const WORKED = "Worked by the watcher";

function boardUrl(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("The tests need a baseURL.");
  return base.replace(/\/$/, "");
}

type Prop = { id: string; name: string; options?: { id: string; name: string }[] };

async function setUp(page: Page, name: string) {
  await register(page, "Queue Keeper");
  const projectId = await createProject(page, unique(name));
  const data = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const prop = (n: string) => (data.properties as Prop[]).find((p) => p.name === n)!;
  const status = prop("Status");
  const option = (n: string) => status.options!.find((o) => o.name === n)!.id;

  const { agent } = await (
    await page.request.post(`/api/projects/${projectId}/agents`, { data: { name: "Picker" } })
  ).json();
  const { secret } = await (
    await page.request.post(`/api/projects/${projectId}/agents/${agent.id}/tokens`, { data: {} })
  ).json();

  // The view the docs give as the example: Status is Todo · Not blocked.
  const { view } = await (
    await page.request.post(`/api/projects/${projectId}/views`, {
      data: { name: "Agent queue", kind: "list" },
    })
  ).json();
  const ruled = await page.request.patch(`/api/views/${view.id}`, {
    data: {
      filters: {
        rules: [
          { propertyId: status.id, op: "is", values: [option("Todo")] },
          { propertyId: "_blocked", op: "is", values: ["false"] },
        ],
      },
    },
  });
  expect(ruled.status()).toBe(200);

  const add = async (title: string, values: Record<string, unknown> = {}) => {
    const { task } = await (
      await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title, values } })
    ).json();
    return task as { id: string; key: string };
  };

  return {
    projectId,
    agentId: agent.id as string,
    token: secret as string,
    viewId: view.id as string,
    assignee: prop("Assignee"),
    option,
    status,
    add,
  };
}

/** Starts the watcher and collects what it prints. */
function startWatcher(token: string, args: string[]) {
  const harness =
    `node ${JSON.stringify(BOARD_MJS)} comment {key} ${JSON.stringify(WORKED)} && ` +
    `node ${JSON.stringify(BOARD_MJS)} finish {key} --log worked`;
  const child = spawn(process.execPath, [BOARD_MJS, "watch", "--run", harness, ...args], {
    env: { ...process.env, USHABTI_URL: boardUrl(), USHABTI_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = { text: "" };
  child.stdout.on("data", (chunk) => (out.text += chunk));
  child.stderr.on("data", (chunk) => (out.text += chunk));
  const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
  const said = (text: string, timeout = 30_000) =>
    expect.poll(() => out.text, { timeout, message: out.text }).toContain(text);
  return { child, out, exited, said };
}

async function commentsOf(page: Page, taskId: string): Promise<string[]> {
  const { task } = await (await page.request.get(`/api/tasks/${taskId}`)).json();
  return task.comments.map((c: { body: string }) => c.body);
}

test.describe("A watcher that takes only what a view shows", () => {
  test("holds an assigned task outside the view, says so once, and starts it when it enters", async ({
    page,
  }, testInfo) => {
    const s = await setUp(page, "Held");
    const blocker = await s.add("Lay the cable", { [s.status.id]: s.option("Todo") });
    const waiting = await s.add("Light the hall", { [s.status.id]: s.option("Todo") });
    const outside = await s.add("Paint the door", { [s.status.id]: s.option("In Progress") });
    expect(
      (
        await page.request.post(`/api/tasks/${waiting.id}/blockers`, {
          data: { blockerId: blocker.id },
        })
      ).status(),
    ).toBeLessThan(300);

    // Matched without regard to case.
    const w = startWatcher(s.token, ["--on", "assigned,mention", "--view", "agent QUEUE"]);
    try {
      await w.said(`takes only what the view "Agent queue" shows`);
      await w.said("listening on");

      // A mention wakes it on a task the view does not show.
      await page.request.post(`/api/tasks/${outside.id}/comments`, {
        data: { body: "@Picker what colour?" },
      });
      await w.said(`${outside.key}: mention in the comment`);
      await w.said(`${outside.key}: done`);
      expect(await commentsOf(page, outside.id)).toContain(WORKED);

      // Given a blocked task: held, with one comment naming the view.
      const assigned = await page.request.put(`/api/tasks/${waiting.id}/values/${s.assignee.id}`, {
        data: { value: s.agentId },
      });
      expect(assigned.ok()).toBeTruthy();
      await w.said(`${waiting.key}: assigned, held until it is in the view "Agent queue"`);
      const said = `I wait until this task is in the view "Agent queue", then I start on it.`;
      await expect.poll(() => commentsOf(page, waiting.id)).toEqual([said]);

      // Another ring reads the queue again, and the hold says nothing twice.
      await page.request.post(`/api/tasks/${outside.id}/comments`, { data: { body: "Thanks" } });
      await page.request.put(`/api/tasks/${waiting.id}/values/${s.assignee.id}`, {
        data: { value: s.agentId },
      });
      await page.waitForTimeout(1_500);
      expect(await commentsOf(page, waiting.id)).toEqual([said]);
      const run = (await (await page.request.get(`/api/tasks/${waiting.id}`)).json()).task.run;
      expect(run).toBeNull();

      await page.goto(`/p/${s.projectId}?task=${waiting.key}`);
      await expect(page.getByText(said)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("seen-held-comment.png") });

      // The blocker is over: the task enters the view and starts by itself.
      expect((await page.request.post(`/api/tasks/${blocker.id}/archive`)).status()).toBe(200);
      await w.said(`${waiting.key}: assigned\n`);
      await w.said(`${waiting.key}: done`);
      expect(await commentsOf(page, waiting.id)).toEqual([said, WORKED]);
    } finally {
      w.child.kill("SIGTERM");
    }
  });

  test("an unknown view fails at start and lists the views there are", async ({ page }) => {
    const s = await setUp(page, "Unknown");
    const w = startWatcher(s.token, ["--view", "Nope"]);
    expect(await w.exited).toBe(1);
    expect(w.out.text).toContain(`No view "Nope"`);
    expect(w.out.text).toContain(`The views are: "Board", "List", "Agent queue".`);
    expect(w.out.text).not.toContain("listening on");
  });

  test("a view deleted while it runs stops the watcher with a non-zero exit", async ({ page }) => {
    const s = await setUp(page, "Deleted");
    const w = startWatcher(s.token, ["--view", "Agent queue"]);
    try {
      await w.said("listening on");
      expect((await page.request.delete(`/api/views/${s.viewId}`)).status()).toBe(200);
      const code = await Promise.race([
        w.exited,
        new Promise<"timeout">((done) => setTimeout(() => done("timeout"), 20_000)),
      ]);
      expect(code, w.out.text).toBe(1);
      expect(w.out.text).toContain(`the view "Agent queue" was deleted`);

      // It never fell back to taking everything: a task given after is not taken.
      const later = await s.add("Nobody takes this", { [s.assignee.id]: s.agentId });
      await page.waitForTimeout(500);
      expect(await commentsOf(page, later.id)).toEqual([]);
    } finally {
      w.child.kill("SIGTERM");
    }
  });
});
