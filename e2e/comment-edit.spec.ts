import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  addTask,
  card,
  createProject,
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
  await anna.page.getByTestId("comment-box").fill("The tests are gren");
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
      await expect(editor).toHaveValue("The tests are gren");
      const update = anna.getByRole("button", { name: "Update", exact: true });
      // Nothing changed yet, so there is nothing to update.
      await expect(update).toBeDisabled();
      await editor.fill("The tests are green");
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

  test("a save that crossed a newer one asks Keep mine or Take theirs", async ({ browser }) => {
    const { anna, projectId, close } = await oneComment(browser);
    // A second tab of the same author, as the only other writer a comment has.
    const other = await anna.context().newPage();
    await other.goto(anna.url());
    await expect(other.getByTestId("comment-markdown")).toHaveText("The tests are gren");

    await other.getByTestId("comment").hover();
    await other.getByRole("button", { name: "Edit", exact: true }).click();
    await other.getByTestId("comment-editor").fill("Second tab");

    await anna.getByTestId("comment").hover();
    await anna.getByRole("button", { name: "Edit", exact: true }).click();
    await anna.getByTestId("comment-editor").fill("First tab");
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
