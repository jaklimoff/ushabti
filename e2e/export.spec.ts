import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

/**
 * The whole project as one file.
 *
 * What the unit test cannot reach is the road: an admin presses a button on
 * the Project page and a file is saved, and it holds the work the board has
 * — a live task with its comment and checklist, and an archived one. A member
 * is not offered the row, and an agent token is refused at the door.
 */

async function makeTask(page: Page, projectId: string, title: string): Promise<string> {
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { task: { id: string } }).task.id;
}

async function memberId(page: Page, projectId: string, name: string): Promise<string> {
  const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const member = (board.members as { id: string; name: string }[]).find((m) => m.name === name);
  if (!member) throw new Error(`${name} is not on the board.`);
  return member.id;
}

type ExportFile = {
  format: string;
  project: { key: string };
  tasks: {
    title: string;
    archivedAt: string | null;
    checklist: { text: string }[];
    comments: { body: string }[];
    blockedBy: string[];
  }[];
};

test("an admin downloads the project; a member is not offered it and an agent is refused", async ({
  page,
  browser,
}) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const admin = await register(adminPage, "Ada Admin");
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const member = await register(memberPage, "Bob Member");

  await register(page, "Olga Owner");
  const projectId = await createProject(page, unique("Export"));
  const as = page.request;
  for (const email of [admin.email, member.email]) {
    expect(
      (await as.post(`/api/projects/${projectId}/members`, { data: { email } })).ok(),
    ).toBeTruthy();
  }
  const adaId = await memberId(page, projectId, "Ada Admin");
  expect(
    (
      await as.patch(`/api/projects/${projectId}/members/${adaId}`, { data: { role: "admin" } })
    ).ok(),
  ).toBeTruthy();

  const live = await makeTask(page, projectId, "Write the export");
  expect(
    (await as.post(`/api/tasks/${live}/comments`, { data: { body: "Started on it." } })).ok(),
  ).toBeTruthy();
  expect(
    (await as.post(`/api/tasks/${live}/checklist`, { data: { text: "Pick the fields" } })).ok(),
  ).toBeTruthy();
  const old = await makeTask(page, projectId, "An old idea");
  expect((await as.post(`/api/tasks/${old}/archive`)).ok()).toBeTruthy();
  /* A deleted task was a mistake, so neither it nor what hangs off it is in
     the file — not even as a blocker of a task that is. */
  const gone = await makeTask(page, projectId, "A mistake");
  expect(
    (await as.post(`/api/tasks/${gone}/comments`, { data: { body: "Never mind." } })).ok(),
  ).toBeTruthy();
  expect(
    (await as.post(`/api/tasks/${live}/blockers`, { data: { blockerId: gone } })).ok(),
  ).toBeTruthy();
  expect((await as.delete(`/api/tasks/${gone}`)).ok()).toBeTruthy();

  /* ---- the admin saves the file from Settings → Project -------------- */

  await gotoSettings(adminPage, projectId, "project");
  const download = adminPage.waitForEvent("download");
  await adminPage.getByRole("link", { name: "Download" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^ushabti-[A-Z0-9]+-\d{4}-\d{2}-\d{2}\.json$/);

  const file = JSON.parse(await readFile(await saved.path(), "utf8")) as ExportFile;
  expect(file.format).toBe("ushabti-export");
  const written = file.tasks.find((t) => t.title === "Write the export");
  expect(written?.archivedAt).toBeNull();
  expect(written?.comments.map((c) => c.body)).toEqual(["Started on it."]);
  expect(written?.checklist.map((c) => c.text)).toEqual(["Pick the fields"]);
  expect(file.tasks.find((t) => t.title === "An old idea")?.archivedAt).toBeTruthy();
  expect(file.tasks.find((t) => t.title === "A mistake")).toBeUndefined();
  expect(written?.blockedBy).toEqual([]);
  expect(JSON.stringify(file)).not.toContain("Never mind.");

  /* ---- a member sees no row, and the door is shut to them ------------ */

  await gotoSettings(memberPage, projectId, "project");
  await expect(memberPage.getByLabel("Project name")).toBeVisible();
  await expect(memberPage.getByText("Export", { exact: true })).toHaveCount(0);
  await expect(memberPage.getByRole("link", { name: "Download" })).toHaveCount(0);
  expect((await memberPage.request.get(`/api/projects/${projectId}/export`)).status()).toBe(403);

  /* ---- an agent token is refused ------------------------------------- */

  const made = await as.post(`/api/projects/${projectId}/agents`, { data: { name: "Helper" } });
  const agentId = ((await made.json()) as { agent: { id: string } }).agent.id;
  const issued = await as.post(`/api/projects/${projectId}/agents/${agentId}/tokens`, {
    data: { name: "export" },
  });
  const secret = ((await issued.json()) as { secret: string }).secret;
  const refused = await page.request.get(`/api/projects/${projectId}/export`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(refused.status()).toBe(403);

  await adminContext.close();
  await memberContext.close();
});
