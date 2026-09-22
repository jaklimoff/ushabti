import { expect, test, type Page } from "@playwright/test";
import { addTask, createProject, gotoSettings, register, unique } from "./helpers";

/**
 * The `@` picker.
 *
 * An agent wakes on its own name, and a name with a space is easy to mistype.
 * So the proof is the written words: what the box holds after Enter is what
 * the watcher looks for.
 */

/** Makes a machine member. Its name has a space, which is the hard case. */
async function addAgent(page: Page, projectId: string, name: string) {
  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill(name);
  await page.getByRole("button", { name: "Add agent" }).click();
  await expect(page.getByTestId("agent-box").filter({ hasText: name })).toBeVisible();
}

const AGENT = "Night Builder";

test.describe("Who an @ can name", () => {
  test("the list opens under the comment box, and Enter writes the whole name", async ({
    page,
  }) => {
    await register(page, "Ada Lovelace");
    const projectId = await createProject(page, unique("Mentions"));
    await addAgent(page, projectId, AGENT);

    await page.goto(`/p/${projectId}`);
    await addTask(page, "Todo", "Ask the agent");

    const box = page.getByTestId("comment-box");
    await box.click();
    await box.pressSequentially("Please look, ");
    await expect(page.getByTestId("mention-list")).toBeHidden();

    // The agents come first: the mention is what wakes one.
    await box.pressSequentially("@");
    await expect(page.getByTestId("mention-list")).toBeVisible();
    await expect(page.getByTestId("mention-item").first()).toHaveAttribute("data-name", AGENT);
    await expect(page.getByTestId("mention-item")).toHaveCount(2);

    // The letters narrow it, by the start of any word in the name.
    await box.pressSequentially("buil");
    await expect(page.getByTestId("mention-item")).toHaveCount(1);

    await box.press("Enter");
    await expect(page.getByTestId("mention-list")).toBeHidden();
    await expect(box).toHaveValue(`Please look, @${AGENT} `);

    await box.pressSequentially("today");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByTestId("comment-markdown")).toContainText(
      `Please look, @${AGENT} today`,
    );
  });

  test("Escape closes the list and leaves the @, and no match closes it too", async ({ page }) => {
    await register(page, "Ada Lovelace");
    const projectId = await createProject(page, unique("Mentions"));
    await addAgent(page, projectId, AGENT);

    await page.goto(`/p/${projectId}`);
    await addTask(page, "Todo", "Ask the agent");

    const box = page.getByTestId("comment-box");
    await box.click();
    await box.pressSequentially("@nig");
    await expect(page.getByTestId("mention-list")).toBeVisible();

    await box.press("Escape");
    await expect(page.getByTestId("mention-list")).toBeHidden();
    // Escape belongs to the list while it is open. The words stay.
    await expect(box).toHaveValue("@nig");

    // Typing on with no match closes the list without a word.
    await box.pressSequentially(" @zzz");
    await expect(page.getByTestId("mention-list")).toBeHidden();
  });

  test("the title and the description of the panel offer the same list", async ({ page }) => {
    await register(page, "Ada Lovelace");
    const projectId = await createProject(page, unique("Mentions"));
    await addAgent(page, projectId, AGENT);

    await page.goto(`/p/${projectId}`);
    await addTask(page, "Todo", "Ask the agent");

    const title = page.getByTestId("task-title");
    await title.click();
    await title.press("End");
    await title.pressSequentially(" @nig");
    await expect(page.getByTestId("mention-list")).toBeVisible();
    await title.press("Enter");
    await expect(title).toHaveValue(`Ask the agent @${AGENT} `);

    // The name is saved like anything else typed in the box.
    await title.blur();
    await expect(page.getByTestId("card").first()).toContainText(`@${AGENT}`);

    await page.getByText("Add a description…").click();
    const editor = page.getByPlaceholder("Write in markdown…");
    await editor.pressSequentially("Over to @nig");
    await expect(page.getByTestId("mention-list")).toBeVisible();
    await editor.press("Enter");
    await expect(editor).toHaveValue(`Over to @${AGENT} `);
    await editor.blur();
    await expect(page.getByTestId("markdown")).toContainText(`Over to @${AGENT}`);
  });
});
