import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  addTask,
  card,
  createProject,
  expectBoxValue,
  fillBox,
  gotoSettings,
  inDatabase,
  register,
  unique,
} from "./helpers";

/**
 * A typo in a comment used to cost the comment: delete it and write it again,
 * at the bottom of the thread. Now its author edits it in place, the way the
 * description is edited, and the thread says that it changed. The box's keys
 * and its closed tab are `src/components/board/Comments.test.tsx`; who may
 * edit is `src/lib/__tests__/comments-route.test.ts`.
 */

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** Anna owns a project with one task and one comment of hers; Ben is a member with it open. */
async function oneComment(browser: Browser) {
  const anna = await freshPage(browser);
  const ben = await freshPage(browser);
  await register(anna.page, "Anna Owner");
  const projectId = await createProject(anna.page, unique("Edit"));
  const benAccount = await register(ben.page, "Ben Friend");

  await gotoSettings(anna.page, projectId, "people");
  await anna.page.getByLabel("Email of the new member").fill(benAccount.email);
  await anna.page.getByRole("button", { name: "Add member" }).click();
  await expect(anna.page.getByText(benAccount.email)).toBeVisible();

  await anna.page.goto(`/p/${projectId}`);
  await addTask(anna.page, "Todo", "Talked about");
  await expect(anna.page.getByTestId("task-panel")).toBeVisible();
  await fillBox(anna.page.getByTestId("comment-box"), "The tests are gren");
  await anna.page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(anna.page.getByTestId("comment-markdown")).toHaveText("The tests are gren");

  await ben.page.goto(`/p/${projectId}`);
  await expect(ben.page.getByTestId("live-dot")).toBeVisible();
  await card(ben.page, "Talked about").click();
  await expect(ben.page.getByTestId("comment-markdown")).toHaveText("The tests are gren");

  const close = async () => {
    await anna.context.close();
    await ben.context.close();
  };
  return { anna: anna.page, ben: ben.page, projectId, close };
}

/* Typing and a pick take less than a button's 140 ms fade, so a shot taken
   at once draws Update halfway from grey. It waits for the fades to end. */
async function stillScreen(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
}

/** Runs `action` and answers the status of the comment save it sends. */
async function statusOf(page: Page, action: () => Promise<void>) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/comments\/[0-9a-f-]+$/.test(r.url()) && r.request().method() === "PATCH",
    ),
    action(),
  ]);
  return response.status();
}

async function savedComment(projectId: string) {
  return inDatabase(async (client) => {
    const { rows } = await client.query<{
      id: string;
      body: string;
      created_at: Date;
      edited_at: Date | null;
    }>(
      `SELECT c.id, c.body, c.created_at, c.edited_at FROM comments c
         JOIN tasks t ON t.id = c.task_id WHERE t.project_id = $1`,
      [projectId],
    );
    return rows;
  });
}

test.describe("The author of a comment can edit it", () => {
  test(
    "the author edits in place, Update saves it, it reads edited, and reaches the other panel",
    { tag: "@smoke" },
    async ({ browser }) => {
      const { anna, ben, projectId, close } = await oneComment(browser);
      const [before] = await savedComment(projectId);
      expect(before.edited_at).toBeNull();

      // Only the author is offered the control.
      await expect(ben.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);

      await anna.getByTestId("comment").hover();
      await anna.getByRole("button", { name: "Edit", exact: true }).click();
      const editor = anna.getByTestId("comment-editor");
      await expectBoxValue(editor, "The tests are gren");
      const update = anna.getByRole("button", { name: "Update", exact: true });
      // Nothing changed yet, so there is nothing to update.
      await expect(update).toBeDisabled();
      await fillBox(editor, "The tests are green");
      await expect(update).toBeEnabled();
      expect(await statusOf(anna, () => update.click())).toBe(200);

      await expect(editor).toHaveCount(0);
      await expect(anna.getByTestId("comment-markdown")).toHaveText("The tests are green");
      await expect(anna.getByTestId("comment-edited")).toBeVisible();

      const [after] = await savedComment(projectId);
      expect(after.body).toBe("The tests are green");
      expect(after.edited_at).not.toBeNull();
      expect(after.created_at.getTime()).toBe(before.created_at.getTime());

      // The time of the edit shows on focus, not only under the pointer.
      const mark = anna.getByTestId("comment-edited");
      await anna.mouse.move(0, 0);
      await expect(mark.getByRole("tooltip")).toBeHidden();
      await mark.focus();
      await expect(mark.getByRole("tooltip")).toBeVisible();

      await expect(ben.getByTestId("comment-markdown")).toHaveText("The tests are green", {
        timeout: 15_000,
      });
      await expect(ben.getByTestId("comment-edited")).toBeVisible();
      await expect(ben.getByTestId("comment")).toHaveCount(1);

      await anna.getByRole("tab", { name: /^Activity/ }).click();
      await expect(anna.getByText("Anna Owner edited a comment")).toHaveCount(1);
      await expect(anna.getByText("Anna Owner left a comment")).toHaveCount(1);

      await close();
    },
  );

  /* The two comment boxes are the description's editor: every line but the
     cursor's reads as the page will draw it, and the @ list works in both. */
  test("the composer and the edit draw Markdown as it is typed", async ({ browser }, testInfo) => {
    const { anna, close } = await oneComment(browser);

    const composer = anna.getByTestId("comment-box");
    await composer.click();
    await anna.keyboard.type("**Ready** for ");
    await anna.keyboard.type("@Ben");
    await expect(anna.getByTestId("mention-list")).toBeVisible();
    await anna.keyboard.press("Enter");
    await expect(anna.getByTestId("mention-list")).toHaveCount(0);
    await anna.keyboard.press("Enter");
    await anna.keyboard.type("Second line");
    await expectBoxValue(composer, "**Ready** for @Ben Friend \nSecond line");
    // The first line is rendered; the cursor's line shows its marks.
    await expect(composer.locator(".cm-lp-strong")).toHaveText("Ready");
    await stillScreen(anna);
    await anna.screenshot({ path: testInfo.outputPath("seen-composer-live.png") });

    await anna.keyboard.press("ControlOrMeta+Enter");
    const posted = anna.getByTestId("comment-markdown").nth(1);
    await expect(posted.locator("strong")).toHaveText("Ready");
    await expectBoxValue(composer, "");

    const second = anna.getByTestId("comment").nth(1);
    await second.hover();
    await second.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = anna.getByTestId("comment-editor");
    await expect(editor).toBeFocused();
    await expect(editor.locator(".cm-lp-strong")).toHaveText("Ready");
    await anna.keyboard.type(" and @Ann");
    await expect(anna.getByTestId("mention-list")).toBeVisible();
    await anna.keyboard.press("Enter");
    await expectBoxValue(editor, "**Ready** for @Ben Friend \nSecond line and @Anna Owner ");
    // The pick leaves the focus in the edit, and the edit reached its draft.
    await expect(editor).toBeFocused();
    await expect(composer).not.toBeFocused();
    await expect(anna.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
    await stillScreen(anna);
    await anna.screenshot({ path: testInfo.outputPath("seen-comment-edit-live.png") });

    expect(await statusOf(anna, () => anna.keyboard.press("ControlOrMeta+Enter"))).toBe(200);
    await expect(editor).toHaveCount(0);
    await expect(posted).toContainText("Second line and @Anna Owner");
    await close();
  });

  test("a save that crossed a newer one asks Keep mine or Take theirs", async ({ browser }) => {
    const { anna, projectId, close } = await oneComment(browser);
    // A second tab of the same author, as the only other writer a comment has.
    const other = await anna.context().newPage();
    await other.goto(anna.url());
    await expect(other.getByTestId("comment-markdown")).toHaveText("The tests are gren");

    await other.getByTestId("comment").hover();
    await other.getByRole("button", { name: "Edit", exact: true }).click();
    await fillBox(other.getByTestId("comment-editor"), "Second tab");

    await anna.getByTestId("comment").hover();
    await anna.getByRole("button", { name: "Edit", exact: true }).click();
    await fillBox(anna.getByTestId("comment-editor"), "First tab");
    expect(
      await statusOf(anna, () => anna.getByTestId("comment-editor").press("ControlOrMeta+Enter")),
    ).toBe(200);

    expect(
      await statusOf(other, () => other.getByTestId("comment-editor").press("ControlOrMeta+Enter")),
    ).toBe(409);
    const question = other.getByTestId("changed-while-typing");
    await expect(question.getByTestId("changed-theirs")).toHaveText("First tab");
    await expect(question.getByTestId("changed-mine")).toHaveText("Second tab");
    expect((await savedComment(projectId))[0].body).toBe("First tab");

    expect(
      await statusOf(other, () => question.getByRole("button", { name: "Keep mine" }).click()),
    ).toBe(200);
    await expect(question).toHaveCount(0);
    await expect(other.getByTestId("comment-markdown")).toHaveText("Second tab");
    expect((await savedComment(projectId))[0].body).toBe("Second tab");

    await close();
  });
});
