import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, inDatabase, overflow, register, unique } from "./helpers";

/** Adds a person with an account from the People page, as the owner does. */
async function addMember(page: Page, email: string, name: string) {
  await page.getByLabel("Email of the new member").fill(email);
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText(name)).toBeVisible();
}

async function memberId(page: Page, projectId: string, name: string): Promise<string> {
  const board = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
  const member = (board.members as { id: string; name: string }[]).find((m) => m.name === name);
  if (!member) throw new Error(`${name} is not on the board.`);
  return member.id;
}

async function changeRole(page: Page, name: string, role: string) {
  const answer = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && /\/members\//.test(res.url()),
  );
  await page.getByLabel(`Role of ${name}`).selectOption(role);
  expect((await answer).ok()).toBeTruthy();
}

test.describe("Roles", () => {
  test("an admin adds an agent and issues its token; a member and the agent cannot", async ({
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
    const projectId = await createProject(page, unique("Roles"));
    await gotoSettings(page, projectId, "people");
    await addMember(page, admin.email, "Ada Admin");
    await addMember(page, member.email, "Bob Member");

    // The owner's own row has no select; the others do, and it saves on change.
    await expect(page.getByLabel("Role of Olga Owner")).toHaveCount(0);
    await changeRole(page, "Ada Admin", "admin");

    const bobId = await memberId(page, projectId, "Bob Member");
    const ownerId = await memberId(page, projectId, "Olga Owner");

    /* ---- a member is refused ------------------------------------------ */

    const refused = await memberPage.request.post(`/api/projects/${projectId}/agents`, {
      data: { name: "Nope" },
    });
    expect(refused.status()).toBe(403);

    /* ---- the admin adds an agent and issues its token from Settings --- */

    await gotoSettings(adminPage, projectId, "people");
    await adminPage.getByLabel("Name of the new agent").fill("Helper");
    await adminPage.getByRole("button", { name: "Add agent" }).click();
    const agentBox = adminPage.getByTestId("agent-box").filter({ hasText: "Helper" });
    await agentBox.getByRole("button", { name: "Connect" }).click();
    const secret = adminPage.getByTestId("agent-secret").first();
    const token = ((await secret.locator("code").first().textContent()) ?? "").trim();
    expect(token).toMatch(/^ush_/);

    // The admin's row shows its role, and offers no select to change it.
    await expect(adminPage.getByLabel("Role of Ada Admin")).toHaveCount(0);
    await expect(adminPage.getByLabel("Role of Olga Owner")).toHaveCount(0);

    /* ---- people and structure are the admin's too -------------------- */

    const as = adminPage.request;
    const invited = `${unique("guest")}@example.com`;
    expect(
      (await as.post(`/api/projects/${projectId}/members`, { data: { email: invited } })).ok(),
    ).toBeTruthy();
    expect(
      (await as.delete(`/api/projects/${projectId}/invites/${encodeURIComponent(invited)}`)).ok(),
    ).toBeTruthy();
    const board = await (await as.get(`/api/projects/${projectId}/board`)).json();
    type Prop = { id: string; name: string; options: { id: string }[] };
    const priority = (board.properties as Prop[]).find((p) => p.name === "Priority")!;
    const labels = (board.properties as Prop[]).find((p) => p.name === "Labels")!;
    expect((await as.delete(`/api/options/${priority.options[0].id}`)).ok()).toBeTruthy();
    expect((await as.delete(`/api/properties/${labels.id}`)).ok()).toBeTruthy();

    /* ---- what stays the owner's --------------------------------------- */

    expect((await as.delete(`/api/projects/${projectId}`)).status()).toBe(403);
    expect(
      (
        await as.patch(`/api/projects/${projectId}/members/${bobId}`, { data: { role: "owner" } })
      ).status(),
    ).toBe(403);
    expect((await as.delete(`/api/projects/${projectId}/members/${ownerId}`)).status()).toBe(403);

    // An admin may make a member an admin, and then cannot undo it or remove them.
    expect(
      (
        await as.patch(`/api/projects/${projectId}/members/${bobId}`, { data: { role: "admin" } })
      ).status(),
    ).toBe(200);
    expect(
      (
        await as.patch(`/api/projects/${projectId}/members/${bobId}`, { data: { role: "member" } })
      ).status(),
    ).toBe(403);
    expect((await as.delete(`/api/projects/${projectId}/members/${bobId}`)).status()).toBe(403);

    /* ---- a token is a member, whoever issued it ----------------------- */

    const headers = { Authorization: `Bearer ${token}` };
    const agentTries = [
      memberPage.request.post(`/api/projects/${projectId}/agents`, {
        headers,
        data: { name: "Nope" },
      }),
      memberPage.request.post(`/api/projects/${projectId}/members`, {
        headers,
        data: { email: "x@example.com" },
      }),
      memberPage.request.get(`/api/projects/${projectId}/webhooks`, { headers }),
      memberPage.request.patch(`/api/projects/${projectId}/members/${bobId}`, {
        headers,
        data: { role: "member" },
      }),
      // A person the project does not have, and a body that is no JSON: still 403.
      memberPage.request.patch(`/api/projects/${projectId}/members/${crypto.randomUUID()}`, {
        headers: { ...headers, "Content-Type": "application/json" },
        data: "not json",
      }),
      memberPage.request.delete(`/api/projects/${projectId}/members/${crypto.randomUUID()}`, {
        headers,
      }),
    ];
    for (const answer of await Promise.all(agentTries)) expect(answer.status()).toBe(403);

    await adminContext.close();
    await memberContext.close();
  });

  test("make owner asks first and leaves the old owner an admin", async ({ page, browser }) => {
    const theirs = await browser.newContext();
    const them = await theirs.newPage();
    const next = await register(them, "Nia Next");

    await register(page, "Olga Owner");
    const projectId = await createProject(page, unique("Handover"));
    await gotoSettings(page, projectId, "people");
    await addMember(page, next.email, "Nia Next");

    // The page holds still at phone width with a select on the row.
    await page.setViewportSize({ width: 375, height: 740 });
    await expect(page.getByLabel("Role of Nia Next")).toBeVisible();
    expect(await overflow(page)).toBe(0);

    await page.getByLabel("Role of Nia Next").selectOption("owner");
    await expect(page.getByText("Make Nia Next the owner? You become an admin.")).toBeVisible();
    await page.getByRole("button", { name: "Yes, make owner" }).click();

    // Nobody can change the owner's role, and the old owner cannot change their own.
    await expect(page.getByLabel("Role of Nia Next")).toHaveCount(0);
    await expect(page.getByLabel("Role of Olga Owner")).toHaveCount(0);

    const owners = await inDatabase(async (client) => {
      const res = await client.query<{ role: string; name: string }>(
        `select m.role, u.name from project_members m join users u on u.id = m.user_id
          where m.project_id = $1 order by u.name`,
        [projectId],
      );
      const project = await client.query<{ owner_id: string }>(
        `select owner_id from projects where id = $1`,
        [projectId],
      );
      return { rows: res.rows, ownerId: project.rows[0].owner_id };
    });
    expect(owners.rows).toEqual([
      { name: "Nia Next", role: "owner" },
      { name: "Olga Owner", role: "admin" },
    ]);
    expect(owners.ownerId).toBe(await memberId(page, projectId, "Nia Next"));

    // The delete is the owner's alone, so the old owner no longer sees it.
    await gotoSettings(page, projectId, "project");
    await expect(page.getByText("Delete this project")).toHaveCount(0);

    await theirs.close();
  });
});
