import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

type Answer = {
  tasks: { id: string; title: string }[];
  properties: { id: string; name: string; options: { id: string; name: string }[] }[];
  taskCount?: number;
};

/** Every read of the board or of Settings that Settings makes, by path. */
function reads(page: Page) {
  const seen: string[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    /* Only what Settings asks: the board this page left can still ring. */
    const from = req.headers()["referer"] ?? "";
    if (
      req.method() === "GET" &&
      from.includes("/settings") &&
      /\/api\/projects\/[^/]+\/(board|settings)$/.test(path)
    ) {
      seen.push(path.split("/").pop()!);
    }
  });
  return seen;
}

/** Eight tasks, and one that carries more than the rest. */
async function eightTasks(page: Page, projectId: string): Promise<string> {
  const answer: Answer = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const priority = answer.properties.find((p) => p.name === "Priority")!;
  const heavy = unique("Heavy");
  for (let i = 0; i < 7; i++) {
    await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title: `Light ${i}` },
    });
  }
  await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title: heavy, values: { [priority.id]: priority.options[0].id } },
  });
  return heavy;
}

test.describe("Settings reads its own loader", () => {
  test("opening Settings reads no task", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Load"));
    await eightTasks(page, projectId);

    const seen = reads(page);
    await gotoSettings(page, projectId, "project");
    await expect(page.getByRole("heading", { name: "Project" })).toBeVisible();

    const answer: Answer = await (
      await page.request.get(`/api/projects/${projectId}/settings`)
    ).json();
    // The few the preview draws, and a count of the rest.
    expect(answer.tasks.length).toBeLessThanOrEqual(4);
    expect(answer.taskCount).toBe(8);
    expect(seen).not.toContain("board");
  });

  test("a change by somebody else updates Settings without reading the board", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Load"));
    await eightTasks(page, projectId);

    await gotoSettings(page, projectId, "properties");
    const before: Answer = await (
      await page.request.get(`/api/projects/${projectId}/settings`)
    ).json();
    const priority = before.properties.find((p) => p.name === "Priority")!;
    await expect(page.getByLabel("Name of the Priority property")).toBeVisible();

    const seen = reads(page);
    /* Sent past the tab, with no client of its own, so the stream rings this
       tab as it would for anybody else. */
    const name = unique("Urgency").slice(0, 30);
    await page.request.patch(`/api/properties/${priority.id}`, { data: { name } });

    await expect(page.getByLabel(`Name of the ${name} property`)).toBeVisible();
    expect(seen).toContain("settings");
    expect(seen).not.toContain("board");
  });

  test("the card view preview in Settings still draws real tasks", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Load"));
    const heavy = await eightTasks(page, projectId);

    const seen = reads(page);
    await gotoSettings(page, projectId, "card");
    await expect(page.getByText(heavy)).toBeVisible();
    expect(seen).not.toContain("board");
  });

  test("a previewed task counts its parts and its blockers as the board does", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Load"));
    const heavy = await eightTasks(page, projectId);
    const make = async (title: string): Promise<string> =>
      (
        await (
          await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } })
        ).json()
      ).task.id;

    const board: Answer = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    const heavyId = board.tasks.find((t) => t.title === heavy)!.id;
    const parent = await make("Parent");
    const done = await make("Part done");
    await page.request.put(`/api/tasks/${await make("Part open")}/parent`, {
      data: { parentId: parent },
    });
    await page.request.put(`/api/tasks/${done}/parent`, { data: { parentId: parent } });
    await page.request.post(`/api/tasks/${done}/archive`);
    await page.request.post(`/api/tasks/${heavyId}/blockers`, { data: { blockerId: parent } });

    type Card = { id: string; parts: unknown; blockedBy: string[] };
    const settings: { tasks: Card[] } = await (
      await page.request.get(`/api/projects/${projectId}/settings`)
    ).json();
    const whole: { tasks: Card[] } = await (
      await page.request.get(`/api/projects/${projectId}/board`)
    ).json();
    const ids = settings.tasks.map((t) => t.id);
    expect(ids).toContain(heavyId);
    expect(ids).toContain(parent);
    for (const task of settings.tasks) {
      expect(task).toEqual(whole.tasks.find((t) => t.id === task.id));
    }
    expect(settings.tasks.find((t) => t.id === parent)!.parts).toEqual({ done: 1, total: 2 });
    expect(settings.tasks.find((t) => t.id === heavyId)!.blockedBy).toHaveLength(1);
  });
});
