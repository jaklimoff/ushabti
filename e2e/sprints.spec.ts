import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

/**
 * Sprints in one step, from Settings → Project.
 *
 * The unit test holds the shape of the two filters. What it cannot reach is
 * the road: the row says what it makes, one press makes all three in one go,
 * the row then says so, and what it made is ordinary — renamed and deleted by
 * the same routes as anything else. The door is shut to a member and an agent.
 */

type Board = {
  properties: {
    id: string;
    name: string;
    type: string;
    config: { dated?: boolean };
    options: unknown[];
  }[];
  views: {
    id: string;
    name: string;
    kind: string;
    groupById: string | null;
    isDefault: boolean;
    filters: { rules: { propertyId: string; op: string; values?: string[] }[] };
  }[];
};

async function board(page: Page, projectId: string): Promise<Board> {
  return (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as Board;
}

test("an admin sets up sprints in one press; a member and an agent are refused", async ({
  page,
  browser,
}) => {
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const member = await register(memberPage, "Bob Member");

  await register(page, "Olga Owner");
  const projectId = await createProject(page, unique("Sprints"));
  const as = page.request;
  expect(
    (await as.post(`/api/projects/${projectId}/members`, { data: { email: member.email } })).ok(),
  ).toBeTruthy();

  /* ---- the door is shut to a member and to an agent ----------------- */

  const url = `/api/projects/${projectId}/sprints`;
  expect((await memberPage.request.post(url)).status()).toBe(403);
  const made = await as.post(`/api/projects/${projectId}/agents`, { data: { name: "Helper" } });
  const agentId = ((await made.json()) as { agent: { id: string } }).agent.id;
  const issued = await as.post(`/api/projects/${projectId}/agents/${agentId}/tokens`, {
    data: { name: "sprints" },
  });
  const secret = ((await issued.json()) as { secret: string }).secret;
  const refused = await memberPage.request.post(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(refused.status()).toBe(403);
  expect((await board(page, projectId)).properties.map((p) => p.name)).not.toContain("Sprint");

  /* ---- a member is not offered the row ------------------------------- */

  await gotoSettings(memberPage, projectId, "project");
  await expect(memberPage.getByLabel("Project name")).toBeVisible();
  await expect(memberPage.getByRole("button", { name: "Set up sprints" })).toHaveCount(0);

  /* ---- the row says what it makes, then makes it --------------------- */

  const before = await board(page, projectId);
  const main = before.views.find((v) => v.isDefault)!;

  await gotoSettings(page, projectId, "project");
  const press = page.getByRole("button", { name: "Set up sprints" });
  await expect(press).toBeVisible();
  await expect(page.getByText(/a select property Sprint, a board Sprint/)).toBeVisible();
  await expect(page.getByText(/a list Backlog of the tasks in no sprint/)).toBeVisible();

  const answer = page.waitForResponse((res) => res.url().endsWith("/sprints"));
  await press.click();
  expect((await answer).status()).toBe(201);
  await expect(page.getByText("Sprints are set up.")).toBeVisible();
  await expect(press).toHaveCount(0);

  const after = await board(page, projectId);
  const sprint = after.properties.find((p) => p.name === "Sprint")!;
  /* A sprint is an option with dates, so the boxes are on from the start. */
  expect(sprint).toMatchObject({ type: "select", config: { dated: true }, options: [] });
  const added = after.views.filter((v) => !before.views.some((b) => b.id === v.id));
  expect(added.map((v) => [v.name, v.kind])).toEqual([
    ["Sprint", "board"],
    ["Backlog", "list"],
  ]);
  const [sprintBoard, backlog] = added;
  expect(sprintBoard.groupById).toBe(main.groupById);
  expect(sprintBoard.filters.rules).toEqual([
    { propertyId: sprint.id, op: "is", values: ["__current__"] },
  ]);
  expect(backlog.filters.rules).toEqual([
    { propertyId: sprint.id, op: "is", values: ["__none__"] },
  ]);
  expect(added.every((v) => !v.isDefault)).toBe(true);

  /* ---- a second press makes nothing twice ----------------------------- */

  expect((await as.post(url)).status()).toBe(409);
  const again = await board(page, projectId);
  expect(again.properties.filter((p) => p.name === "Sprint")).toHaveLength(1);
  expect(again.views).toHaveLength(after.views.length);

  /* ---- everything it made is an ordinary row ------------------------- */

  expect(
    (await as.patch(`/api/views/${sprintBoard.id}`, { data: { name: "This sprint" } })).ok(),
  ).toBeTruthy();
  expect(
    (await as.patch(`/api/properties/${sprint.id}`, { data: { name: "Iteration" } })).ok(),
  ).toBeTruthy();
  const renamed = await board(page, projectId);
  expect(renamed.views.find((v) => v.id === sprintBoard.id)?.name).toBe("This sprint");
  expect(renamed.properties.find((p) => p.id === sprint.id)).toMatchObject({
    name: "Iteration",
    config: { dated: true },
  });

  expect((await as.delete(`/api/views/${sprintBoard.id}`)).ok()).toBeTruthy();
  expect((await as.delete(`/api/views/${backlog.id}`)).ok()).toBeTruthy();
  expect((await as.delete(`/api/properties/${sprint.id}`)).ok()).toBeTruthy();
  const gone = await board(page, projectId);
  expect(gone.views.map((v) => v.id).sort()).toEqual(before.views.map((v) => v.id).sort());
  expect(gone.properties.map((p) => p.id)).not.toContain(sprint.id);

  /* With no Sprint left, the row offers the press again. */
  await page.reload();
  await expect(page.getByRole("button", { name: "Set up sprints" })).toBeVisible();

  await memberContext.close();
});
