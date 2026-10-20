import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, hydrated, register, unique } from "./helpers";

/*
 * The May line of an agent in Settings -> People, against the real server:
 * a click saves, and the server refuses the act while it is off. Every act and
 * every route behind it is `agent-acts-route.test.ts`.
 */
test("an admin lets an agent delete tasks on the May line, and takes it back", async ({
  page,
}, testInfo) => {
  await register(page, "Acts Owner");
  const projectId = await createProject(page, unique("Acts"));

  const { agent } = await (
    await page.request.post(`/api/projects/${projectId}/agents`, { data: { name: "Keeper" } })
  ).json();
  const { secret } = await (
    await page.request.post(`/api/projects/${projectId}/agents/${agent.id}/tokens`, { data: {} })
  ).json();
  const headers = { Authorization: `Bearer ${secret}`, "x-forwarded-for": unique("198.51.100") };
  const deleteOne = async () => {
    const { task } = await (
      await page.request.post(`/api/projects/${projectId}/tasks`, {
        headers,
        data: { title: unique("Doomed") },
      })
    ).json();
    return page.request.delete(`/api/tasks/${task.id}`, { headers });
  };

  // Delete starts off, and the server says so whatever the agent was told.
  const refused = await deleteOne();
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error).toBe("This project does not let Keeper delete tasks.");

  await gotoSettings(page, projectId, "people");
  const box = page.getByTestId("agent-box").filter({ hasText: "Keeper" });
  // Folded, the agent's line already says what it may not do.
  const head = box.getByRole("button", { expanded: false });
  await expect(head).toContainText("May everything but delete · 1 token");
  await expect(head).toContainText("Silent");
  await page.screenshot({ path: testInfo.outputPath("seen-agents-folded.png") });
  await hydrated(head);
  await head.click();
  const may = box.getByTestId("agent-may");
  const del = may.getByRole("checkbox", { name: "Keeper may delete tasks" });
  await expect(del).not.toBeChecked();
  await expect(may.getByRole("checkbox", { name: "Keeper may create tasks" })).toBeChecked();

  const saved = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes(`/agents/${agent.id}`),
  );
  await del.click();
  expect((await saved).status()).toBe(200);
  await expect(del).toBeChecked();
  expect((await deleteOne()).status()).toBe(200);

  await page.reload();
  // The page opens with every agent folded, and the line follows the switch.
  await expect(head).toContainText("May everything · 1 token");
  await hydrated(head);
  await head.click();
  await expect(del).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("seen-agent-may.png") });

  await del.click();
  await expect(del).not.toBeChecked();
  await expect.poll(async () => (await deleteOne()).status()).toBe(403);
});
