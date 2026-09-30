import { expect, test, type Locator, type Page } from "@playwright/test";
import { addTask, card, createProject, gotoSettings, register, saved, unique } from "./helpers";

/** A click on a swatch saves at once; this waits for the save to answer. */
async function pick(page: Page, swatch: Locator) {
  const answer = page.waitForResponse(
    (res) => /\/agents\/[0-9a-f-]{36}$/.test(res.url()) && res.request().method() === "PATCH",
  );
  await swatch.click();
  expect((await answer).status()).toBe(200);
}

test.describe("The face of an agent", () => {
  test("an owner changes an agent's colour and emoji, a member cannot, and another board follows", async ({
    page,
    browser,
  }) => {
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const member = await register(memberPage, "Bob Member");

    await register(page, "Olga Owner");
    const projectId = await createProject(page, unique("Agent face"));
    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Email of the new member").fill(member.email);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Bob Member")).toBeVisible();
    await page.getByLabel("Name of the new agent").fill("Painter");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Painter" });
    await expect(agentBox).toBeVisible();

    /* ---- the agent holds a card on the member's open board ------------- */

    await page.goto(`/p/${projectId}`);
    await addTask(page, "Todo", "Painted by an agent");
    const panel = page.getByTestId("task-panel");
    await panel.getByRole("button", { name: "Assignee Unassigned", exact: true }).click();
    await saved(page, () => panel.getByRole("option", { name: "Painter", exact: true }).click());
    await page.getByRole("button", { name: "Close task" }).click();

    await memberPage.goto(`/p/${projectId}`);
    const face = card(memberPage, "Painted by an agent").locator('[title="Painter"]');
    await expect(face).toHaveText("◆");
    await expect(face.getByTestId("agent-badge")).toHaveCount(0);

    /* ---- the owner picks a colour and an emoji ------------------------- */

    await gotoSettings(page, projectId, "people");
    await agentBox.getByRole("button", { name: "Face of Painter" }).click();
    const colours = agentBox.getByRole("radiogroup", { name: "Colour of Painter" });
    await expect(colours.getByRole("radio")).toHaveCount(11);
    await pick(page, colours.getByRole("radio", { name: "Colour #2f9e7a" }));
    await expect(colours.getByRole("radio", { name: "Colour #2f9e7a" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const emojis = agentBox.getByRole("radiogroup", { name: "Emoji of Painter" });
    await pick(page, emojis.getByRole("radio", { name: "Face 🦊" }));
    await expect(agentBox.getByTestId("agent-badge").first()).toBeVisible();

    // The member's board heard the broadcast, and was not reloaded.
    await expect(face).toContainText("🦊");
    await expect(face).toHaveCSS("background-color", "rgb(47, 158, 122)");
    await expect(face.getByTestId("agent-badge")).toHaveText("◆");

    await page.reload();
    await agentBox.getByRole("button", { name: "Face of Painter" }).click();
    await expect(emojis.getByRole("radio", { name: "Face 🦊" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    /* ---- the member sees the agent and cannot change it ---------------- */

    await gotoSettings(memberPage, projectId, "people");
    const theirBox = memberPage.getByTestId("agent-box").filter({ hasText: "Painter" });
    await expect(theirBox).toBeVisible();
    await expect(theirBox.getByRole("button", { name: "Face of Painter" })).toHaveCount(0);
    const agents = await (await memberPage.request.get(`/api/projects/${projectId}/agents`)).json();
    const agentId = (agents.agents as { id: string; name: string }[]).find(
      (a) => a.name === "Painter",
    )!.id;
    const refused = await memberPage.request.patch(`/api/projects/${projectId}/agents/${agentId}`, {
      data: { emoji: null },
    });
    expect(refused.status()).toBe(403);

    /* ---- the agent comments, and the panel still says it is an agent --- */

    await agentBox.getByRole("button", { name: "Connect" }).click();
    const secret = page.getByTestId("agent-secret").first();
    const token = ((await secret.locator("code").first().textContent()) ?? "").trim();
    const board = await (await memberPage.request.get(`/api/projects/${projectId}/board`)).json();
    const taskId = (board.tasks as { id: string; title: string }[]).find(
      (t) => t.title === "Painted by an agent",
    )!.id;
    const commented = await memberPage.request.post(`/api/tasks/${taskId}/comments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { body: "Painted it green." },
    });
    expect(commented.ok()).toBeTruthy();
    await memberPage.goto(`/p/${projectId}`);
    await card(memberPage, "Painted by an agent").click();
    const comment = memberPage.getByTestId("comment").filter({ hasText: "Painted it green." });
    await expect(comment.locator('[title="Painter"]')).toContainText("🦊");
    await expect(comment.getByTestId("agent-badge")).toHaveText("◆");
    await memberPage.getByRole("button", { name: "Close task" }).click();
    await gotoSettings(page, projectId, "people");
    await agentBox.getByRole("button", { name: "Face of Painter" }).click();

    /* ---- the owner clears the emoji, and the ◆ comes back -------------- */

    await pick(page, emojis.getByRole("radio", { name: "No emoji" }));
    await memberPage.goto(`/p/${projectId}`);
    await expect(face).toHaveText("◆");
    await expect(face.getByTestId("agent-badge")).toHaveCount(0);

    await memberContext.close();
  });
});
