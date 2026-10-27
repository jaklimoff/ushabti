import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  addTask,
  backdateRun,
  card,
  centreOf,
  createProject,
  dragCard,
  gotoSettings,
  register,
  unique,
} from "./helpers";

/** The calls an agent makes, each token from an address of its own. */
function agentApi(request: APIRequestContext, token: string) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "x-forwarded-for": unique("198.51.100"),
  };
  return {
    get: (path: string) => request.get(path, { headers }),
    post: (path: string, data: unknown = {}) => request.post(path, { headers, data }),
    patch: (path: string, data: unknown = {}) => request.patch(path, { headers, data }),
    put: (path: string, data: unknown = {}) => request.put(path, { headers, data }),
  };
}

async function agentToken(page: Page, projectId: string, name: string): Promise<string> {
  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill(name);
  await page.getByRole("button", { name: "Add agent" }).click();
  const agentBox = page.getByTestId("agent-box").filter({ hasText: name });
  await agentBox.getByRole("button", { name: "Connect" }).click();
  await agentBox.getByRole("button", { name: "Make token" }).click();
  return (
    (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
  ).trim();
}

/*
 * The card's one quiet line after the lease closed a run. The rule itself is
 * `stoppedAnswering` in `run-state.test.ts`; this walks it through a board:
 * the line, an agent's write that leaves it, a new run and a person's drag
 * that take it away, and a run the agent ended itself that never shows it.
 */
test.describe("A card whose agent stopped answering", () => {
  test("says so until somebody answers it", async ({ page, request }, testInfo) => {
    await register(page, "Stop Owner");
    const projectId = await createProject(page, unique("Stopped"));
    await addTask(page, "Todo", "Left by a sleeping host");
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "Todo", "Ended by the agent");
    await page.getByRole("button", { name: "Close task" }).click();
    await addTask(page, "Todo", "Picked up again");
    await page.getByRole("button", { name: "Close task" }).click();

    const api = agentApi(request, await agentToken(page, projectId, "Reis"));
    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    const idOf = (title: string) =>
      board.tasks.find((t: { title: string }) => t.title === title).id as string;
    const priority = board.properties.find((p: { name: string }) => p.name === "Priority");
    const high = priority.options.find((o: { name: string }) => o.name === "High").id;
    const start = async (title: string) =>
      (
        await (
          await api.post(`/api/tasks/${idOf(title)}/run`, { goal: "Work", step: "Working" })
        ).json()
      ).run as { id: string };

    const left = await start("Left by a sleeping host");
    const ended = await start("Ended by the agent");
    const again = await start("Picked up again");
    // Silent past the lease, so the next read closes both.
    await backdateRun(left.id, 40);
    await backdateRun(again.id, 40);
    // The agent ended this one itself, with the same word the board uses.
    expect((await api.patch(`/api/runs/${ended.id}`, { status: "lost" })).ok()).toBe(true);

    await page.goto(`/p/${projectId}`);
    const leftCard = card(page, "Left by a sleeping host").first();
    const line = leftCard.getByTestId("card-stopped");
    await expect(line.getByTestId("card-stopped-text")).toHaveText(
      /^Reis stopped answering · \d\d:\d\d$/,
    );
    await expect(leftCard.getByTestId("card-run")).toBeHidden();
    await expect(card(page, "Picked up again").first().getByTestId("card-stopped")).toBeVisible();

    /* ---- the agent ended its own run: nothing to warn about ----------- */

    const endedCard = card(page, "Ended by the agent").first();
    await expect(endedCard).toBeVisible();
    await expect(endedCard.getByTestId("card-stopped")).toBeHidden();
    await expect(endedCard.getByTestId("card-run")).toBeHidden();

    /* ---- a new run on the task takes the line away -------------------- */

    const next = await start("Picked up again");
    await page.reload();
    const againCard = card(page, "Picked up again").first();
    await expect(againCard.getByTestId("card-run")).toBeVisible();
    await expect(againCard.getByTestId("card-stopped")).toBeHidden();
    // And it stays away once that run finishes as it should.
    expect((await api.patch(`/api/runs/${next.id}`, { status: "done" })).ok()).toBe(true);
    await page.reload();
    await expect(againCard).toBeVisible();
    await expect(againCard.getByTestId("card-run")).toBeHidden();
    await expect(againCard.getByTestId("card-stopped")).toBeHidden();

    /* ---- an agent's write is no answer -------------------------------- */

    const wrote = await api.put(
      `/api/tasks/${idOf("Left by a sleeping host")}/values/${priority.id}`,
      {
        value: high,
      },
    );
    expect(wrote.ok()).toBe(true);
    await page.reload();
    // Visible, because a streamed page holds the card in a hidden chunk first.
    await expect(line).toBeVisible();
    await expect(line).toContainText("Reis stopped answering");
    await page.screenshot({ path: testInfo.outputPath("seen-stopped.png") });

    /* ---- a person moving the card is ---------------------------------- */

    await dragCard(page, "Left by a sleeping host", await centreOf(page, "In Progress"));
    await expect(line).toBeHidden();
    await page.reload();
    await expect(leftCard).toBeVisible();
    await expect(line).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("seen-answered.png") });
  });
});
