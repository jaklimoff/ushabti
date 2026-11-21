import { expect, test, type Page } from "@playwright/test";
import { addTask, createProject, gotoSettings, inDatabase, register, unique } from "./helpers";

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

/* USH-469: the Activity tab wears faces, narrows to people or agents, and
   reads past its newest sixty lines. */
test("the Activity tab marks agents, narrows to them, and shows older lines", async ({
  page,
}, testInfo) => {
  await register(page, "Jack");
  const projectId = await createProject(page, unique("Faces"));
  await addTask(page, "Todo", "Retries stop after five tries");
  const token = await connectAgent(page, projectId, "Reis");

  const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const task = board.tasks.find(
    (t: { title: string }) => t.title === "Retries stop after five tries",
  );
  // Sixty lines by the person, so the tab holds more than one page.
  await inDatabase((db) =>
    db.query(
      `insert into activity (project_id, task_id, actor_id, kind, data, created_at)
       select $1, $2, (select created_by from tasks where id = $2), 'description', '{}',
              now() - interval '1 hour' + n * interval '1 second'
         from generate_series(1, 60) as n`,
      [projectId, task.id],
    ),
  );
  // The task's own first line is the oldest, so it sits on the second page.
  await inDatabase((db) =>
    db.query(
      `update activity set created_at = now() - interval '1 day' where task_id = $1 and kind = 'created'`,
      [task.id],
    ),
  );
  const renamed = await page.request.patch(`/api/tasks/${task.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: "Retries stop after three tries" },
  });
  expect(renamed.ok()).toBeTruthy();

  await page.goto(`/p/${projectId}?task=${task.key}`);
  await page.getByRole("tab", { name: /^Activity/ }).click();
  const lines = page.getByTestId("activity-line");
  await expect(lines).toHaveCount(60);

  const agentLine = lines.filter({ hasText: "Reis renamed it" });
  await expect(agentLine.getByTitle("Reis")).toContainText("◆");
  await expect(lines.filter({ hasText: "Jack created the task" })).toHaveCount(0);

  const group = page.getByRole("group", { name: "Whose activity" });
  await group.getByRole("button", { name: "Agents" }).click();
  await expect(group.getByRole("button", { name: "Agents" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(lines).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("seen-activity-agents.png") });

  await group.getByRole("button", { name: "People" }).click();
  await expect(lines).toHaveCount(59);
  await expect(lines.first().getByTitle("Jack")).toBeVisible();

  await group.getByRole("button", { name: "Everyone" }).click();
  await page.getByRole("button", { name: "Show older" }).click();
  await expect(lines).toHaveCount(62);
  await expect(lines.last()).toContainText("Jack created the task");
  await expect(page.getByRole("button", { name: "Show older" })).toHaveCount(0);
  await lines.last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("seen-activity-older.png") });
});
