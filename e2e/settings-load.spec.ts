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

/*
 * A change by somebody else reaches Settings through the stream, which only
 * a real server rings. What the loader answers, and that the card view
 * preview draws it, moved to `settings-route.test.ts` and
 * `CardViewPanel.test.tsx` (USH-279).
 */

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
});
