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
    /* The stream has no replay, so a change made before it opens is never
       heard. Under load the owner's pick can beat it; wait for the dot. */
    await expect(memberPage.getByTestId("live-dot")).toBeVisible();
    await expect(face.getByTestId("agent-badge")).toHaveCount(0);

    /* ---- the owner picks a colour and an emoji ------------------------- */

    await gotoSettings(page, projectId, "people");
    await agentBox.getByRole("button", { name: "Face of Painter" }).click();
    const colours = agentBox.getByRole("radiogroup", { name: "Colour of Painter" });
    await expect(colours.getByRole("radio")).toHaveCount(11);
    /* An agent's first colour comes from the project's id, so one run in
       eleven it already wears the green, and a click on it saves nothing. */
    const green = colours.getByRole("radio", { name: "Colour #2f9e7a" });
    if ((await green.getAttribute("aria-checked")) === "true") {
      await pick(page, colours.getByRole("radio", { name: "Colour #e0574d" }));
    }
    await pick(page, green);
    await expect(colours.getByRole("radio", { name: "Colour #2f9e7a" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const emojis = agentBox.getByRole("radiogroup", { name: "Emoji of Painter" });
    await pick(page, emojis.getByRole("radio", { name: "Face 🦊" }));
    await expect(agentBox.getByTestId("agent-badge").first()).toBeVisible();
    // The swatch's fill and ring end at one edge, as the avatar's do.
    await expect(emojis.getByRole("radio", { name: "Face 🦊" })).toHaveCSS(
      "background-clip",
      "padding-box",
    );

    // The member's board heard the broadcast, and was not reloaded.
    await expect(face).toContainText("🦊");
    // An emoji sits on a dark tint of the colour, inside a ring of it.
    await expect(face).toHaveCSS("background-color", "rgb(27, 57, 51)");
    await expect(face).toHaveCSS("box-shadow", "rgb(47, 158, 122) 0px 0px 0px 1px inset");
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

    await agentBox.getByRole("button", { name: "Make token" }).click();
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

  test("an owner types any one emoji for an agent, and other text saves nothing", async ({
    page,
  }) => {
    await register(page, "Olga Owner");
    const projectId = await createProject(page, unique("Agent emoji box"));
    await gotoSettings(page, projectId, "people");
    await page.getByLabel("Name of the new agent").fill("Typist");
    await page.getByRole("button", { name: "Add agent" }).click();
    const agentBox = page.getByTestId("agent-box").filter({ hasText: "Typist" });
    await agentBox.getByRole("button", { name: "Face of Typist" }).click();
    const emojis = agentBox.getByRole("radiogroup", { name: "Emoji of Typist" });
    const box = agentBox.getByRole("textbox", { name: "Or type any emoji" });
    let patches = 0;
    page.on("request", (req) => {
      if (/\/agents\/[0-9a-f-]{36}$/.test(req.url()) && req.method() === "PATCH") patches += 1;
    });

    for (const text of ["🦊🦊", "ok", "🏿"]) {
      await box.fill(text);
      await expect(agentBox.getByText("One emoji only.")).toBeVisible();
    }
    expect(patches).toBe(0);

    const answer = page.waitForResponse(
      (res) => /\/agents\/[0-9a-f-]{36}$/.test(res.url()) && res.request().method() === "PATCH",
    );
    await box.fill("🤖");
    expect((await answer).status()).toBe(200);
    await expect(box).toHaveValue("");
    await expect(agentBox.getByText("One emoji only.")).toHaveCount(0);
    await expect(emojis.getByRole("radio", { name: "Face 🤖" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await page.reload();
    await agentBox.getByRole("button", { name: "Face of Typist" }).click();
    await expect(emojis.getByRole("radio", { name: "Face 🤖" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
