import { expect, test, type Page } from "@playwright/test";
import { addTask, createProject, gotoSettings, register, unique } from "./helpers";

/**
 * The spike of USH-178: the description is a CodeMirror box whose lines read
 * as rendered markdown, except the line the cursor is on.
 */

const AGENT = "Night Builder";

async function openDescription(page: Page) {
  await register(page, "Ada Lovelace");
  const projectId = await createProject(page, unique("Live"));
  await gotoSettings(page, projectId, "people");
  await page.getByLabel("Name of the new agent").fill(AGENT);
  await page.getByRole("button", { name: "Add agent" }).click();
  await expect(page.getByTestId("agent-box").filter({ hasText: AGENT })).toBeVisible();
  await page.goto(`/p/${projectId}`);
  await addTask(page, "Todo", "Write it live");
  await page.getByText("Add a description…").click();
  const editor = page.getByTestId("live-editor");
  await expect(editor).toBeFocused();
  return editor;
}

test.describe("The live description", () => {
  test("hides the marks on every line but the cursor's", async ({ page }) => {
    const editor = await openDescription(page);
    await editor.pressSequentially("## Plan");
    await editor.press("Enter");
    await editor.pressSequentially("**bold** and ~~gone~~ and `code`");
    await editor.press("Enter");
    await editor.pressSequentially("- [ ] open item");
    await editor.press("Enter");
    await editor.press("Enter");

    // The cursor is on the last, empty line, so every line above reads rendered.
    await expect(editor).toContainText("Plan");
    await expect(editor).not.toContainText("##");
    await expect(editor).not.toContainText("**");
    await expect(editor.locator(".cm-lp-strong")).toHaveText("bold");
    await expect(editor.locator(".cm-lp-strike")).toHaveText("gone");
    await expect(editor.locator(".cm-lp-code")).toHaveText("code");

    // A tick writes the words.
    const box = editor.locator(".cm-lp-task");
    await expect(box).not.toBeChecked();
    await box.click();
    await expect(editor.locator(".cm-lp-task")).toBeChecked();

    // Back on the heading, its marks come back.
    await editor.press("ControlOrMeta+Home");
    await expect(editor.locator(".cm-line").first()).toHaveText("## Plan");

    await editor.press("ControlOrMeta+Enter");
    await expect(page.getByTestId("markdown")).toContainText("bold and gone and code");
    await expect(page.getByTestId("markdown").locator("input[type=checkbox]")).toBeChecked();
  });

  test("the @ list works inside it, with the same keys", async ({ page }) => {
    const editor = await openDescription(page);
    await editor.pressSequentially("Over to @nig");
    await expect(page.getByTestId("mention-list")).toBeVisible();
    await editor.press("Escape");
    await expect(page.getByTestId("mention-list")).toBeHidden();
    // Escape closed the list and nothing else.
    await expect(editor).toBeVisible();
    await editor.pressSequentially("h");
    await editor.press("Backspace");
    await expect(page.getByTestId("mention-list")).toBeVisible();
    await editor.press("Enter");
    await expect(page.getByTestId("mention-list")).toBeHidden();
    await expect(editor).toHaveText(`Over to @${AGENT} `);
    await editor.pressSequentially("today");
    await expect(editor).toHaveText(`Over to @${AGENT} today`);
    await editor.blur();
    await expect(page.getByTestId("markdown")).toContainText(`Over to @${AGENT} today`);
  });
});
