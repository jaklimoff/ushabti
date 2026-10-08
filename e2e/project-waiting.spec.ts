import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

/** The calls an agent makes, with the token in place of a session cookie. */
function agentApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    get: (url: string) => request.get(url, { headers }),
    post: (url: string, data: unknown = {}) => request.post(url, { headers, data }),
    patch: (url: string, data: unknown = {}) => request.patch(url, { headers, data }),
  };
}

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

/**
 * A project where an agent asked three questions, then one of those tasks was
 * archived and one deleted. A fourth run handed its task over and a fifth
 * works. Only one question is still somebody's to answer.
 */
async function askInProject(page: Page, request: APIRequestContext, projectId: string) {
  const api = agentApi(request, await connectAgent(page, projectId, "Asker"));
  const run = async (title: string, status?: string) => {
    const made = await api.post(`/api/projects/${projectId}/tasks`, { title });
    const { task } = await made.json();
    const started = await api.post(`/api/tasks/${task.id}/run`, { goal: title });
    const id = (await started.json()).run.id as string;
    if (status) await api.patch(`/api/runs/${id}`, { status, step: "Which queue?" });
    return task.id as string;
  };
  const asks = await run("Asks", "waiting");
  const archived = await run("Asks, then archived", "waiting");
  const deleted = await run("Asks, then deleted", "waiting");
  await run("Hands it over", "handed_over");
  await run("Just works");
  expect((await page.request.post(`/api/tasks/${archived}/archive`)).ok()).toBeTruthy();
  expect((await page.request.delete(`/api/tasks/${deleted}`)).ok()).toBeTruthy();
  return { api, asks };
}

/* The count that changes live, while the menu is open. The numbers the list
   and the agent read are runs-route.test.ts. */
test.describe("How many tasks wait in each project", () => {
  test("reads the top bar's own count for the open project, live", async ({ page, request }) => {
    await register(page, "One Project");
    const name = unique("Open");
    const projectId = await createProject(page, name);
    const { api, asks } = await askInProject(page, request, projectId);

    await page.goto(`/p/${projectId}`);
    await expect(page.getByTestId("waiting-count")).toHaveText("1 waiting");
    await page.getByTestId("project-switcher").click();
    const mine = page
      .getByRole("menuitemradio", { name: new RegExp(name) })
      .getByTestId("project-switcher-waiting");
    await expect(mine).toHaveText("1 waiting");

    /* The answer comes while the menu is open. The list was read when it
       opened, so only the board's own count can take the number away. */
    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const open = board.runs.find((r: { taskId: string }) => r.taskId === asks);
    await api.patch(`/api/runs/${open.id}`, { status: "running", step: "Answered" });
    await expect(page.getByTestId("waiting-count")).toHaveCount(0);
    await expect(mine).toHaveCount(0);
  });
});
