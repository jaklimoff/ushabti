import { expect, test, type Page } from "@playwright/test";
import { pinnedBoardMjs, runStep } from "../src/lib/__tests__/workflow-step";
import { createProject, gotoSettings, register, unique } from "./helpers";

const PR = "https://github.com/acme/shop/pull/12";

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

async function newTask(page: Page, projectId: string, title: string) {
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } });
  expect(made.ok()).toBeTruthy();
  return ((await made.json()) as { task: { id: string; key: string } }).task;
}

/** The value of one property of a task, as the board stores it. */
async function valueOf(page: Page, taskId: string, propertyId: string) {
  const { task } = await (await page.request.get(`/api/tasks/${taskId}`)).json();
  return task.values[propertyId] ?? [];
}

test.describe("The GitHub Actions step", () => {
  test("puts the pull request on the tasks its title and branch name", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Step"));
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Pull requests", type: "link" },
    });
    expect(made.ok()).toBeTruthy();
    const { property } = await made.json();

    const named = await newTask(page, projectId, "Named in the title");
    const branched = await newTask(page, projectId, "Named in the branch");
    const left = await newTask(page, projectId, "Named nowhere");
    const projectKey = named.key.split("-")[0];
    const token = await connectAgent(page, projectId, "GitHub");

    const result = await runStep({
      url: boardUrl(),
      token,
      projectKey,
      title: `Fix the cart (${named.key}, ${projectKey}-9999)`,
      branch: `feature-${branched.key.toLowerCase()}-cart`,
      prUrl: PR,
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain(`No task ${projectKey}-9999 on this board.`);

    expect(await valueOf(page, named.id, property.id)).toEqual([PR]);
    expect(await valueOf(page, branched.id, property.id)).toEqual([PR]);
    expect(await valueOf(page, left.id, property.id)).toEqual([]);

    /* An edited title runs the step again, and the board keeps the link once. */
    const again = await runStep({
      url: boardUrl(),
      token,
      projectKey,
      title: named.key,
      branch: "main",
      prUrl: PR,
    });
    expect(again.code).toBe(0);
    expect(await valueOf(page, named.id, property.id)).toEqual([PR]);
  });

  test("works with the board.mjs that the workflow pins for teams", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Pinned"));
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Pull requests", type: "link" },
    });
    expect(made.ok()).toBeTruthy();
    const { property } = await made.json();
    const task = await newTask(page, projectId, "Linked by the pinned script");
    const token = await connectAgent(page, projectId, "GitHub");

    /* A team runs the file at the pinned commit, not this checkout's copy. */
    const result = await runStep({
      url: boardUrl(),
      token,
      projectKey: task.key.split("-")[0],
      title: task.key,
      branch: "main",
      prUrl: PR,
      board: "pinned",
    });
    expect(result.boardMjs).toEqual(pinnedBoardMjs().toString("utf8"));
    expect(result.output).not.toContain("did not take the token");
    expect(result.code).toBe(0);
    expect(await valueOf(page, task.id, property.id)).toEqual([PR]);
  });

  test("writes a line, and does not fail, on a board with no Link property", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("NoLink"));
    const task = await newTask(page, projectId, "Nowhere to put it");
    const token = await connectAgent(page, projectId, "GitHub");

    const result = await runStep({
      url: boardUrl(),
      token,
      projectKey: task.key.split("-")[0],
      title: task.key,
      branch: "main",
      prUrl: PR,
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain('No property called "Pull requests"');
    expect(result.output).toContain(`${task.key}: the link was not added.`);
  });
});
