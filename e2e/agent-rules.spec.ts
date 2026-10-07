import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { addTask, createProject, gotoSettings, register, settles, unique } from "./helpers";

/**
 * A project tells its agents how to work on its board. An admin writes the
 * rules in Settings; an agent reads them once, on the answer to its claim.
 */

const LABEL = "Agent rules";

async function addMember(page: Page, email: string, name: string) {
  await page.getByLabel("Email of the new member").fill(email);
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText(name)).toBeVisible();
}

async function agentToken(page: Page, projectId: string, name: string): Promise<string> {
  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill(name);
  await page.getByRole("button", { name: "Add agent" }).click();
  const box = page.getByTestId("agent-box").filter({ hasText: name });
  await box.getByRole("button", { name: "Connect" }).click();
  await box.getByRole("button", { name: "Make token" }).click();
  return (
    (await page.getByTestId("agent-secret").first().locator("code").first().textContent()) ?? ""
  ).trim();
}

function agentApi(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    get: (path: string) => request.get(path, { headers }),
    post: (path: string, data: unknown = {}) => request.post(path, { headers, data }),
    patch: (path: string, data: unknown = {}) => request.patch(path, { headers, data }),
  };
}

async function rulesLines(page: Page, projectId: string) {
  const after = encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString());
  const { entries } = await (
    await page.request.get(`/api/projects/${projectId}/activity?after=${after}&limit=200`)
  ).json();
  return (entries as { kind: string; data: { hash: string; text: string } }[]).filter(
    (e) => e.kind === "rules",
  );
}

test.describe("Agent rules", () => {
  test("an admin writes them; the claim carries them, and step and beat do not", async ({
    page,
    browser,
    request,
  }) => {
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const member = await register(memberPage, "Bob Member");

    await register(page, "Olga Owner");
    const projectId = await createProject(page, unique("Rules"));
    await gotoSettings(page, projectId, "people");
    await addMember(page, member.email, "Bob Member");
    const token = await agentToken(page, projectId, "Ruled");
    const api = agentApi(request, token);

    /* ---- the admin writes them, and the field saves on blur ----------- */

    await gotoSettings(page, projectId, "project");
    const box = page.getByLabel(LABEL);
    const rules = "Review means the option Done.\nAsk a person before you estimate.";
    await box.fill(rules);
    await expect(page.getByTestId("agent-rules-count")).toHaveText(
      `${rules.length} / 2,000 characters`,
    );
    await settles(page, /^\/api\/projects\/[0-9a-f-]+$/, () => box.blur());
    await page.reload();
    await expect(page.getByLabel(LABEL)).toHaveValue(rules);

    /* ---- one change, one line; a blur that changed nothing, none ------ */

    await page.getByLabel(LABEL).focus();
    await page.getByLabel(LABEL).blur();
    const lines = await rulesLines(page, projectId);
    expect(lines).toHaveLength(1);
    expect(lines[0].data.text).toBe(rules);

    /* ---- a member and an agent are refused ----------------------------- */

    const byMember = await memberPage.request.patch(`/api/projects/${projectId}`, {
      data: { agentRules: "Do as you like." },
    });
    expect(byMember.status()).toBe(403);
    const byAgent = await api.patch(`/api/projects/${projectId}`, {
      agentRules: "Do as you like.",
    });
    expect(byAgent.status()).toBe(403);
    expect(await rulesLines(page, projectId)).toHaveLength(1);

    /* ---- an agent reads them on the claim, and only there -------------- */

    await page.goto(`/p/${projectId}`);
    await addTask(page, "Todo", "Follow the rules");
    const board = await (await api.get(`/api/projects/${projectId}/board`)).json();
    expect(board.project.agentRules).toBeNull();
    const task = board.tasks.find((t: { title: string }) => t.title === "Follow the rules");

    const claim = await (await api.post(`/api/tasks/${task.id}/run`, { goal: "Build it" })).json();
    expect(claim.rules.text).toBe(rules);
    expect(claim.rules.hash).toBe(lines[0].data.hash);

    const step = await (await api.patch(`/api/runs/${claim.run.id}`, { step: "Working" })).json();
    expect(step).not.toHaveProperty("rules");
    expect(JSON.stringify(step)).not.toContain("Ask a person");
    const beat = await (await api.patch(`/api/runs/${claim.run.id}`, { beat: true })).json();
    expect(beat).not.toHaveProperty("rules");
    expect(JSON.stringify(beat)).not.toContain("Ask a person");

    await memberContext.close();
  });

  test("the rules are saved although the tab was closed on the box", async ({ page }) => {
    await register(page);
    const projectId = await createProject(page, unique("Leaving rules"));

    await gotoSettings(page, projectId, "project");
    await page.getByLabel(LABEL).fill("Done means merged.");

    // The box still has the focus. Closing the tab here is the lost edit.
    const context = page.context();
    await page.close();

    const next = await context.newPage();
    await expect
      .poll(
        async () => {
          await next.goto(`/p/${projectId}/settings/project`);
          return next.getByLabel(LABEL).inputValue();
        },
        { timeout: 20_000 },
      )
      .toBe("Done means merged.");
  });
});
