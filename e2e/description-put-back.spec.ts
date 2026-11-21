import { expect, test, type Page } from "@playwright/test";
import {
  addTask,
  createProject,
  expectBoxValue,
  fillBox,
  inDatabase,
  register,
  unique,
} from "./helpers";

/* USH-471: a description line opens to what changed, and puts it back. */

const FIRST = [
  "## Goal",
  "Fix the offline queue somehow.",
  "",
  "## Context",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "## Out of scope",
  "The sync module.",
].join("\n");

const SECOND = [
  "## Goal",
  "A failed send retries five times, then stops and says so.",
  "",
  "## Context",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "## Out of scope",
  "The sync module and the mobile app.",
  "",
  "## Constraints",
  "No new table.",
].join("\n");

async function taskId(title: string): Promise<string> {
  return inDatabase(async (db) => {
    const res = await db.query<{ id: string }>("select id from tasks where title = $1", [title]);
    return res.rows[0].id;
  });
}

/** Writes the description through the box, and waits for the save. */
async function writeDescription(page: Page, text: string) {
  const editor = page.getByTestId("live-editor");
  await fillBox(editor, text);
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && /\/api\/tasks\/[^/]+$/.test(r.url()),
  );
  await page.getByTestId("task-title").click();
  expect((await saved).ok()).toBe(true);
}

/**
 * Two edits, each its own version: the first is aged past the burst in
 * which one person's saves fold into one edit.
 */
async function twoEdits(page: Page, title: string) {
  await addTask(page, "Todo", title);
  await expect(page.getByRole("tab", { name: /^Comments/ })).toBeVisible();
  await writeDescription(page, FIRST);
  const id = await taskId(title);
  await inDatabase((db) =>
    db.query(
      "update description_versions set created_at = created_at - interval '1 hour' where task_id = $1",
      [id],
    ),
  );
  await writeDescription(page, SECOND);
  await page.getByRole("tab", { name: /^Activity/ }).click();
  return id;
}

test("a description edit opens to its changes and puts back what was there", async ({
  page,
}, testInfo) => {
  await register(page, "Jack");
  await createProject(page, unique("Put back"));
  const title = unique("Retries");
  await twoEdits(page, title);

  const lines = page.getByTestId("activity-line").filter({ hasText: "edited the description" });
  await expect(lines).toHaveCount(2);
  const newest = lines.first();
  await newest.getByRole("button", { name: "Show changes" }).click();
  await expect(newest.getByRole("button", { name: "Hide changes" })).toBeVisible();

  const changes = page.getByTestId("description-changes");
  await expect(changes.getByTestId("description-changes-count")).toHaveText(
    "2 lines taken away · 5 added",
  );
  await expect(changes.getByTestId("changes-gone").first()).toContainText("−");
  await expect(changes.getByTestId("changes-gone").first()).toContainText(
    "Fix the offline queue somehow.",
  );
  await expect(changes.getByTestId("changes-added").first()).toContainText("+");
  // The line that changed in part marks only the words that came.
  await expect(changes.getByTestId("changes-mark")).toHaveText([" and the mobile app"]);
  // Nine lines that stayed keep one on each side and fold seven.
  const fold = changes.getByTestId("description-changes-fold");
  await expect(fold).toHaveText("7 lines the same");
  await changes.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("seen-description-changes.png") });

  // Leave it closes the question and writes nothing.
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH") writes.push(r.url());
  });
  await page.getByTestId("put-back").click();
  const question = page.getByTestId("put-back-question");
  await expect(question).toHaveText(
    /The 5 lines you added go, and the 2 lines come back\. What is there now stays in the history\./,
  );
  await page.screenshot({ path: testInfo.outputPath("seen-put-back-question.png") });
  await question.getByRole("button", { name: "Leave it" }).click();
  await expect(question).toHaveCount(0);
  // Escape leaves it too.
  await page.getByTestId("put-back").click();
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  expect(writes).toEqual([]);

  // The fold opens on a press.
  await fold.click();
  await expect(changes.getByText("Three", { exact: true })).toBeVisible();

  // Yes puts the text back, and a new line says whose edit it was.
  await page.getByTestId("put-back").click();
  await question.getByRole("button", { name: "Yes, put it back" }).click();
  await expect(question).toHaveCount(0);
  const editor = page.getByTestId("live-editor");
  await expectBoxValue(editor, FIRST);
  await expect(
    page.getByText("Jack put the description back as it was before their own edit"),
  ).toBeVisible();
  // Nothing more to put back: the description already holds the before.
  await expect(page.getByTestId("put-back")).toHaveCount(0);

  await page.reload();
  await expectBoxValue(page.getByTestId("live-editor"), FIRST);
  await page.getByRole("tab", { name: /^Activity/ }).click();
  const back = page
    .getByTestId("activity-line")
    .filter({ hasText: "put the description back" })
    .first();
  await expect(back).toContainText("Jack put the description back as it was before their own edit");
  await back.getByRole("button", { name: "Show changes" }).click();
  await expect(page.getByTestId("description-changes-count")).toHaveText(
    "5 lines taken away · 2 added",
  );
  await page.screenshot({ path: testInfo.outputPath("seen-put-back-after.png") });
});

test("a put-back that crosses another edit writes nothing", async ({ page }) => {
  await register(page, "Jack");
  await createProject(page, unique("Crossed"));
  const title = unique("Crossed");
  const id = await twoEdits(page, title);

  const newest = page
    .getByTestId("activity-line")
    .filter({ hasText: "edited the description" })
    .first();
  await newest.getByRole("button", { name: "Show changes" }).click();
  await page.getByTestId("put-back").click();
  await expect(page.getByTestId("put-back-question")).toContainText("The 5 lines you added go");

  // Somebody writes the description while the question is open.
  await inDatabase((db) =>
    db.query("update tasks set description = $1 where id = $2", ["Somebody else's.", id]),
  );
  await page.getByRole("button", { name: "Yes, put it back" }).click();
  await expect(page.getByText("The description changed meanwhile")).toBeVisible();
  await expect(page.getByTestId("put-back-question")).toHaveCount(0);
  const kept = await inDatabase((db) =>
    db.query<{ description: string }>("select description from tasks where id = $1", [id]),
  );
  expect(kept.rows[0].description).toBe("Somebody else's.");
  await expect(page.getByText("put the description back")).toHaveCount(0);
});

test("a description line from before versions has no Show changes", async ({ page }) => {
  await register(page, "Jack");
  await createProject(page, unique("Old line"));
  const title = unique("Old");
  await addTask(page, "Todo", title);
  await expect(page.getByRole("tab", { name: /^Comments/ })).toBeVisible();
  await writeDescription(page, "Written long ago.");
  const id = await taskId(title);
  // A line written before versions were kept names none.
  await inDatabase((db) =>
    db.query("update activity set data = '{}'::jsonb where task_id = $1 and kind = 'description'", [
      id,
    ]),
  );
  await page.reload();
  await page.getByRole("tab", { name: /^Activity/ }).click();
  const line = page.getByTestId("activity-line").filter({ hasText: "edited the description" });
  await expect(line).toHaveCount(1);
  await expect(line.getByRole("button", { name: /changes/ })).toHaveCount(0);
});
