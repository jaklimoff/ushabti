import { expect, test, type Page } from "@playwright/test";
import { card, column, createProject, inDatabase, register, unique } from "./helpers";

type Board = {
  properties: { id: string; name: string }[];
  views: { id: string; isDefault: boolean }[];
  members: { id: string }[];
  former: { id: string; name: string }[];
};

async function board(page: Page, projectId: string): Promise<Board> {
  const res = await page.request.get(`/api/projects/${projectId}/board`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Board;
}

/**
 * Grace joins, takes a task, and leaves through the same route People uses.
 * Leaving deletes only her membership, so the task still names her.
 */
async function graceLeft(page: Page) {
  await register(page, "Ada Lovelace");
  const projectId = await createProject(page, unique("Former"));
  const name = unique("Grace");
  const graceId = await inDatabase(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into users (name, email, color) values ($1, $2, '#2f9e8f') returning id`,
      [name, `${name}@example.com`],
    );
    await client.query(
      `insert into project_members (project_id, user_id, role, position) values ($1, $2, 'member', 'V')`,
      [projectId, rows[0].id],
    );
    return rows[0].id;
  });

  const read = await board(page, projectId);
  const assignee = read.properties.find((p) => p.name === "Assignee")!;
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title: "Grace's work", values: { [assignee.id]: graceId } },
  });
  expect(made.ok()).toBeTruthy();
  const gone = await page.request.delete(`/api/projects/${projectId}/members/${graceId}`);
  expect(gone.ok()).toBeTruthy();

  const after = await board(page, projectId);
  expect(after.members.map((m) => m.id)).not.toContain(graceId);
  expect(after.former).toEqual([expect.objectContaining({ id: graceId, name })]);
  return { projectId, graceId, name, assignee, main: after.views.find((v) => v.isDefault)! };
}

test("a task of somebody who left keeps their name, marked as gone", async ({ page }) => {
  const { projectId, name } = await graceLeft(page);
  await page.goto(`/p/${projectId}`);

  await expect(
    card(page, "Grace's work").locator(`[title="Assignee · ${name} (left)"]`),
  ).toBeVisible();
  await expect(card(page, "Grace's work").locator("[data-gone]")).toBeVisible();

  /* The picker shows her as the value and never offers her. */
  await card(page, "Grace's work").click();
  const panel = page.getByTestId("task-panel");
  const picker = panel.getByRole("button", { name: `Assignee ${name} (left)`, exact: true });
  await expect(picker).toBeVisible();
  await picker.click();
  await expect(panel.getByRole("option", { name: "Ada Lovelace", exact: true })).toBeVisible();
  await expect(panel.getByRole("option", { name: new RegExp(name) })).toHaveCount(0);

  /* Picking somebody else hands the task on. */
  const wrote = page.waitForResponse(
    (r) => /\/api\/tasks\/[0-9a-f-]+\/values/.test(r.url()) && r.request().method() !== "GET",
  );
  await panel.getByRole("option", { name: "Ada Lovelace", exact: true }).click();
  expect((await wrote).ok()).toBeTruthy();
  await expect(
    panel.getByRole("button", { name: "Assignee Ada Lovelace", exact: true }),
  ).toBeVisible();
});

test("a filter picks somebody who left, and Unassigned agrees with the board", async ({ page }) => {
  const { projectId, name, assignee, main } = await graceLeft(page);
  await page.request.patch(`/api/views/${main.id}`, {
    data: { groupById: assignee.id, filters: { rules: [] } },
  });
  await page.goto(`/p/${projectId}`);

  /* Her column sits after the members and before Unassigned, and takes no card. */
  await expect(page.getByTestId("column-name")).toHaveText(["Ada Lovelace", `${name} (left)`]);
  await expect(column(page, `${name} \\(left\\)`).getByText("Grace's work")).toBeVisible();
  await expect(page.getByRole("button", { name: `Add a task to ${name} (left)` })).toHaveCount(0);

  /* The filter lists her under "Left the project", and the chip names her. */
  await page.getByTestId("filter-button").click();
  const search = page.getByTestId("filter-search");
  await search.fill("Assignee");
  await search.press("Enter");
  const menu = page.getByTestId("filter-menu");
  await expect(menu.getByText("Left the project")).toBeVisible();
  await menu.getByRole("option", { name: `${name} (left)` }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText(`Assignee is ${name} (left)`)).toBeVisible();
  await expect(card(page, "Grace's work")).toBeVisible();
});

test("somebody who rejoins reads as a member again", async ({ page }) => {
  const { projectId, graceId, name } = await graceLeft(page);
  await inDatabase((client) =>
    client.query(
      `insert into project_members (project_id, user_id, role, position) values ($1, $2, 'member', 'V')`,
      [projectId, graceId],
    ),
  );
  const read = await board(page, projectId);
  expect(read.former).toEqual([]);
  await page.goto(`/p/${projectId}`);
  await expect(card(page, "Grace's work").locator(`[title="Assignee · ${name}"]`)).toBeVisible();
  await expect(card(page, "Grace's work").locator("[data-gone]")).toHaveCount(0);
});
