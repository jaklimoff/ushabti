import { spawn } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addTask, card, createProject, gotoSettings, register, unique } from "./helpers";

// Playwright runs from the repository root, locally and on CI.
const BOARD_MJS = path.resolve(process.cwd(), "examples/skill/ushabti/board.mjs");

function boardUrl(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("The tests need a baseURL.");
  return base.replace(/\/$/, "");
}

/** Makes an agent in Settings -> People and reads its id and token. */
async function connectAgent(page: Page, projectId: string, name: string) {
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
  const agents = await (await page.request.get(`/api/projects/${projectId}/agents`)).json();
  const id = (agents.agents as { id: string; name: string }[]).find((a) => a.name === name)!.id;
  return { id, token, headers: { Authorization: `Bearer ${token}` } };
}

async function taskId(page: Page, projectId: string, title: string): Promise<string> {
  const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  return (board.tasks as { id: string; title: string }[]).find((t) => t.title === title)!.id;
}

test.describe("Renaming an agent", () => {
  test("an admin renames an agent, its history shows the new name, and a name is one agent's", async ({
    page,
  }) => {
    await register(page, "Rena Owner");
    const projectId = await createProject(page, unique("Agent rename"));
    await addTask(page, "Todo", "Scouted ground");
    await page.getByRole("button", { name: "Close task" }).click();
    const scout = await connectAgent(page, projectId, "Scout");
    const id = await taskId(page, projectId, "Scouted ground");

    /* ---- the agent leaves a run and a comment under its old name ------- */

    const started = await page.request.post(`/api/tasks/${id}/run`, {
      headers: scout.headers,
      data: { goal: "Scout it", step: "Looking around" },
    });
    expect(started.status()).toBe(201);
    const commented = await page.request.post(`/api/tasks/${id}/comments`, {
      headers: scout.headers,
      data: { body: "Found the river." },
    });
    expect(commented.ok()).toBeTruthy();

    /* ---- the owner renames it in Settings, and the field saves on blur -- */

    await gotoSettings(page, projectId, "people");
    const box = page.getByTestId("agent-box").filter({ hasText: "Scout" });
    await box.getByRole("button", { name: "Face of Scout" }).click();
    const field = box.getByRole("textbox", { name: "Name of the agent Scout" });
    await field.fill("  Ranger ");
    const answer = page.waitForResponse(
      (res) => /\/agents\/[0-9a-f-]{36}$/.test(res.url()) && res.request().method() === "PATCH",
    );
    await field.blur();
    expect((await answer).status()).toBe(200);
    await expect(page.getByTestId("agent-box").filter({ hasText: "Ranger" })).toBeVisible();

    /* ---- old history joins the name on read ---------------------------- */

    await page.goto(`/p/${projectId}`);
    const held = card(page, "Scouted ground").first();
    await expect(held.getByTestId("card-run")).toContainText("Ranger");
    await expect(async () => {
      await held.getByText("Scouted ground").click();
      await expect(page.getByTestId("task-panel")).toBeVisible({ timeout: 2_000 });
    }).toPass();
    // A task with a run opens on its Agent tab.
    await expect(page.getByTestId("panel-run").getByText("Ranger")).toBeVisible();
    await page.getByRole("tab", { name: /^Comments/ }).click();
    const comment = page.getByTestId("comment").filter({ hasText: "Found the river." });
    await expect(comment.locator('[title="Ranger"]')).toBeVisible();
    const me = await (await page.request.get("/api/agent/me", { headers: scout.headers })).json();
    expect(me.agent.name).toBe("Ranger");

    /* ---- two agents cannot share a name, in any case ------------------- */

    const second = await page.request.post(`/api/projects/${projectId}/agents`, {
      data: { name: "Helper" },
    });
    expect(second.ok()).toBeTruthy();
    const helper = (await second.json()).agent.id as string;
    const clash = await page.request.patch(`/api/projects/${projectId}/agents/${helper}`, {
      data: { name: "ranger" },
    });
    expect(clash.status()).toBe(409);
    const twin = await page.request.post(`/api/projects/${projectId}/agents`, {
      data: { name: "Ranger" },
    });
    expect(twin.status()).toBe(409);
    // An agent may keep its own name in another case.
    const recased = await page.request.patch(`/api/projects/${projectId}/agents/${scout.id}`, {
      data: { name: "RANGER" },
    });
    expect(recased.status()).toBe(200);
    for (const name of ["", "   ", "x".repeat(81)]) {
      const bad = await page.request.patch(`/api/projects/${projectId}/agents/${helper}`, {
        data: { name },
      });
      expect(bad.status()).toBe(400);
    }

    /* ---- an agent token cannot rename an agent ------------------------- */

    for (const target of [scout.id, helper]) {
      const refused = await page.request.patch(`/api/projects/${projectId}/agents/${target}`, {
        headers: scout.headers,
        data: { name: "Taken over" },
      });
      expect(refused.status()).toBe(403);
    }

    /* ---- a name typed and left without a blur still saves --------------- */

    await gotoSettings(page, projectId, "people");
    const again = page.getByTestId("agent-box").filter({ hasText: "RANGER" });
    await again.getByRole("button", { name: "Face of RANGER" }).click();
    await again.getByRole("textbox", { name: "Name of the agent RANGER" }).fill("Pathfinder");
    await page.goto(`/p/${projectId}`);
    await expect
      .poll(async () => {
        const list = await (await page.request.get(`/api/projects/${projectId}/agents`)).json();
        return (list.agents as { id: string; name: string }[]).find((a) => a.id === scout.id)?.name;
      })
      .toBe("Pathfinder");
  });

  test("a watcher that started before the rename wakes on a mention of the new name", async ({
    page,
  }) => {
    await register(page, "Rena Watcher");
    const projectId = await createProject(page, unique("Rename watch"));
    await addTask(page, "Todo", "Call the ranger");
    await page.getByRole("button", { name: "Close task" }).click();
    const scout = await connectAgent(page, projectId, "Scout");
    const id = await taskId(page, projectId, "Call the ranger");

    const harness = `node ${JSON.stringify(BOARD_MJS)} comment {key} "Heard as Ranger"`;
    const watcher = spawn(
      process.execPath,
      [BOARD_MJS, "watch", "--once", "--on", "mention", "--run", harness],
      {
        env: { ...process.env, USHABTI_URL: boardUrl(), USHABTI_TOKEN: scout.token },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    watcher.stdout.on("data", (chunk) => (output += chunk));
    watcher.stderr.on("data", (chunk) => (output += chunk));
    const exited = new Promise<number | null>((done) => watcher.on("exit", (code) => done(code)));

    try {
      await expect.poll(() => output, { timeout: 15_000 }).toContain("listening on");

      const renamed = await page.request.patch(`/api/projects/${projectId}/agents/${scout.id}`, {
        data: { name: "Ranger" },
      });
      expect(renamed.status()).toBe(200);
      await expect.poll(() => output, { timeout: 15_000 }).toContain("I answer to @Ranger now");

      const asked = await page.request.post(`/api/tasks/${id}/comments`, {
        data: { body: "@Ranger can you look?" },
      });
      expect(asked.ok()).toBeTruthy();

      const code = await Promise.race([
        exited,
        new Promise<"timeout">((done) => setTimeout(() => done("timeout"), 40_000)),
      ]);
      expect(code, output).toBe(0);
      expect(output).toContain(": mention");
      const detail = (await (await page.request.get(`/api/tasks/${id}`)).json()).task;
      expect(detail.comments.map((c: { body: string }) => c.body)).toContain("Heard as Ranger");
    } finally {
      watcher.kill("SIGTERM");
    }
  });
});
