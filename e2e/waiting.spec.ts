import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  addFilter,
  addTask,
  backdateRun,
  card,
  createProject,
  gotoSettings,
  register,
  unique,
} from "./helpers";

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
 * A project where Asker asked two questions, the older one in Backlog, and
 * where one run handed the task over and one works. Answers the ids.
 */
async function askTwice(page: Page, request: APIRequestContext, third = false) {
  await register(page, "Waited On");
  const projectId = await createProject(page, unique("Waiting"));
  await addTask(page, "Backlog", "Older question");
  await page.getByRole("button", { name: "Close task" }).click();
  const more = third ? ["Newest question"] : [];
  for (const title of ["Newer question", "Hands it over", "Just works", ...more]) {
    await addTask(page, "Todo", title);
    await page.getByRole("button", { name: "Close task" }).click();
  }
  const api = agentApi(request, await connectAgent(page, projectId, "Asker"));
  const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
  const idOf = (title: string) =>
    board.tasks.find((t: { title: string }) => t.title === title).id as string;
  const start = async (title: string) =>
    (await (await api.post(`/api/tasks/${idOf(title)}/run`, { goal: title })).json()).run
      .id as string;

  const older = await start("Older question");
  await api.patch(`/api/runs/${older}`, { status: "waiting", step: "Which queue?" });
  await backdateRun(older, 120);
  const newer = await start("Newer question");
  await api.patch(`/api/runs/${newer}`, { status: "waiting", step: "Which region?" });
  const hands = await start("Hands it over");
  await api.patch(`/api/runs/${hands}`, { status: "handed_over", step: "review" });
  await start("Just works");
  if (third) {
    const newest = await start("Newest question");
    await api.patch(`/api/runs/${newest}`, { status: "waiting", step: "Which colour?" });
  }

  await page.goto(`/p/${projectId}`);
  const keyOf = (title: string) =>
    board.tasks.find((t: { title: string }) => t.title === title).key as string;
  return { api, older, newer, keyOf };
}

/* The walk through answering a question from the list, with the count
   following live. What the list draws for a view rule, a folded column, a
   list view and a phone is Waiting.test.tsx. */
test.describe("The questions that wait on a person", () => {
  test("are counted past the filter, listed oldest first, and answered from the list", async ({
    page,
    request,
  }) => {
    const { api, older, newer } = await askTwice(page, request);
    const count = page.getByTestId("waiting-count");

    /* Only an ask counts. A hand-over waits for nobody in particular. */
    await expect(count).toHaveText("2 waiting");
    await expect(page).toHaveTitle(/^\(2\) /);

    /* A filter hides the older one, and the count still knows it. */
    await addFilter(page, "Status", "Todo");
    await expect(card(page, "Older question")).toHaveCount(0);
    await expect(count).toHaveText("2 waiting");

    /* The keyboard opens the list, and the list has the arrows. */
    await count.focus();
    await page.keyboard.press("Enter");
    const rows = page.getByTestId("waiting-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Older question");
    await expect(rows.nth(0)).toContainText("Asker");
    await expect(rows.nth(0)).toContainText("Which queue?");
    await expect(rows.nth(0)).toContainText(/2h/);
    await expect(rows.nth(0)).toContainText("not in this view");
    await expect(rows.nth(1)).toContainText("Newer question");
    await expect(rows.nth(1)).toContainText("Which region?");
    await expect(rows.nth(1)).not.toContainText("not in this view");

    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");

    /* The panel opens with the focus in the answer box. */
    const box = page.getByTestId("comment-box");
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute("placeholder", "Answer Asker…");
    await expect(page.getByTestId("waiting-list")).toHaveCount(0);
    await page.keyboard.type("Europe.");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByTestId("comment").filter({ hasText: "Europe." })).toBeVisible();

    /* The agent reads the answer and works again: the row goes, live. */
    await api.patch(`/api/runs/${newer}`, { status: "running", step: "Reading the answer" });
    await expect(count).toHaveText("1 waiting");
    await expect(page).toHaveTitle(/^\(1\) /);
    await count.click();
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText("Older question");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("waiting-list")).toHaveCount(0);
    await expect(count).toBeFocused();

    /* The last answer takes the count and the title's number away. */
    await api.patch(`/api/runs/${older}`, { status: "running", step: "Reading the answer" });
    await expect(count).toHaveCount(0);
    await expect(page).not.toHaveTitle(/^\(/);
  });
});
