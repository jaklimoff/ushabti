import { spawn } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addTask, createProject, gotoSettings, register, unique } from "./helpers";

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

/* The watcher hearing its new name needs the stream and the shipped client.
   Who may rename and what the history reads are agent-settings-route.test.ts,
   and the field in Settings is PeoplePanel.test.tsx. */
test.describe("Renaming an agent", () => {
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
