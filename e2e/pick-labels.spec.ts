import { expect, test, type Page } from "@playwright/test";
import { card, createProject, register, settles, unique } from "./helpers";

type Property = { id: string; name: string; options: { id: string; name: string }[] };
type Board = {
  properties: Property[];
  tasks: { id: string; title: string; values: Record<string, unknown> }[];
};

/** The one call a bulk set makes. */
const BULK = /\/api\/projects\/[0-9a-f-]+\/tasks\/values$/;

async function board(page: Page, projectId: string): Promise<Board> {
  return (await page.request.get(`/api/projects/${projectId}/board`)).json();
}

/**
 * Thirty tasks in Todo, each with labels of its own: the even ones carry
 * infra, the odd ones ux and docs, and every fifth one bug already.
 */
async function thirty(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Labels"));
  const read = await board(page, projectId);
  const of = (n: string) => read.properties.find((p) => p.name === n)!;
  const status = of("Status");
  const labels = of("Labels");
  const option = (p: Property, n: string) => p.options.find((o) => o.name === n)!.id;
  const todo = option(status, "Todo");
  const [bug, infra, ux, docs] = ["bug", "infra", "ux", "docs"].map((n) => option(labels, n));
  const had: Record<string, string[]> = {};
  for (let i = 0; i < 30; i++) {
    const title = `Task ${String(i).padStart(2, "0")}`;
    const list = i % 2 ? [ux, docs] : [infra];
    if (i % 5 === 0) list.push(bug);
    const res = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title, values: { [status.id]: todo, [labels.id]: list } },
    });
    expect(res.ok()).toBeTruthy();
    had[title] = list;
  }
  await page.reload();
  await expect(card(page, "Task 29")).toBeVisible();
  return { projectId, labels: labels.id, bug, had };
}

/** Picks all thirty with one press and one Shift-press, and opens Labels. */
async function pickAllAndOpenLabels(page: Page) {
  const titles = (await board(page, page.url().split("/p/")[1].split("?")[0])).tasks.map(
    (t) => t.title,
  );
  const sorted = [...titles].sort();
  await card(page, sorted[0]).getByTestId("card-pick").click();
  await card(page, sorted[sorted.length - 1]).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("pick-count")).toHaveText("30 selected");
  await page.getByTestId("pick-set").click();
  const search = page.getByTestId("pick-search");
  await search.fill("Labels");
  await search.press("Enter");
}

test.describe("Set on a multi-select", () => {
  test("adds Bug to thirty tasks and keeps every label they had", async ({ page }) => {
    const { projectId, labels, bug, had } = await thirty(page);
    await pickAllAndOpenLabels(page);

    const menu = page.getByTestId("pick-menu");
    /* It starts on Add and says what a press will do, before it does it. */
    await expect(page.getByTestId("pick-add")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("pick-option-search").fill("bug");
    await expect(page.getByTestId("pick-note")).toHaveText(
      "Adds bug to 24 tasks. Their other Labels stay.",
    );
    await expect(menu.getByRole("option", { name: /bug/ })).toContainText("6 of 30");

    await settles(page, BULK, () => menu.getByRole("option", { name: /bug/ }).click());
    await expect(page.getByTestId("pick-note")).toHaveText("All 30 have bug already.");

    const after = await board(page, projectId);
    for (const task of after.tasks) {
      const list = task.values[labels] as string[];
      expect(new Set(list)).toEqual(new Set([...had[task.title], bug]));
    }
  });

  test("takes one label off many tasks, and the others stay", async ({ page }) => {
    const { projectId, labels, bug, had } = await thirty(page);
    await pickAllAndOpenLabels(page);

    const menu = page.getByTestId("pick-menu");
    await page.getByTestId("pick-remove").click();
    await page.getByTestId("pick-option-search").fill("bug");
    await expect(page.getByTestId("pick-note")).toHaveText(
      "Takes bug off 6 tasks. Their other Labels stay.",
    );

    await settles(page, BULK, () => menu.getByRole("option", { name: /bug/ }).click());
    await expect(page.getByTestId("pick-note")).toHaveText("None of the 30 has bug.");

    const after = await board(page, projectId);
    for (const task of after.tasks) {
      expect(task.values[labels]).toEqual(had[task.title].filter((id) => id !== bug));
    }
  });

  test("the route changes one option and writes nothing on a task it leaves as it was", async ({
    page,
  }) => {
    const { projectId, labels, bug, had } = await thirty(page);
    const ids = (await board(page, projectId)).tasks.map((t) => t.id);

    const res = await page.request.post(`/api/projects/${projectId}/tasks/values`, {
      data: { taskIds: ids, propertyId: labels, value: bug, change: "add" },
    });
    expect(res.ok()).toBeTruthy();
    /* Six carried it already, so twenty-four change. */
    expect(((await res.json()) as { set: number }).set).toBe(24);

    const after = await board(page, projectId);
    for (const task of after.tasks) {
      expect(new Set(task.values[labels] as string[])).toEqual(new Set([...had[task.title], bug]));
    }

    /* A change on a property that is not a multi-select is refused. */
    const status = after.properties.find((p) => p.name === "Status")!;
    const refused = await page.request.post(`/api/projects/${projectId}/tasks/values`, {
      data: { taskIds: ids, propertyId: status.id, value: status.options[0].id, change: "add" },
    });
    expect(refused.status()).toBe(400);
  });
});
