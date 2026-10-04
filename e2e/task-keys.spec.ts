import { expect, test, type Page } from "@playwright/test";
import {
  addTask,
  createProject,
  register,
  saved,
  unique,
  descriptionBox,
  fillBox,
} from "./helpers";

/**
 * A key written in a description or a comment is a link to that task. A plain
 * click opens it in the panel, as a search hit does, and the href is the
 * task's own address for a copy or a ⌘ click.
 */

async function keyOfOpenTask(page: Page): Promise<string> {
  return (await page.getByTestId("task-key").innerText()).trim();
}

test("a key in a description and in a comment opens its task", async ({ page }) => {
  await register(page);
  const projectId = await createProject(page, unique("Keys"));

  await addTask(page, "Todo", "Old work");
  const archived = await keyOfOpenTask(page);
  await page.getByRole("button", { name: "Task menu" }).click();
  await page.getByTestId("archive-task").click();
  await expect(page.getByTestId("archived-row")).toBeVisible();
  await page.getByRole("button", { name: "Close task" }).click();

  await addTask(page, "Todo", "The blocker");
  const blocker = await keyOfOpenTask(page);
  await page.getByRole("button", { name: "Close task" }).click();

  await addTask(page, "Todo", "The waiting one");
  const waiting = await keyOfOpenTask(page);
  const prefix = blocker.split("-")[0];

  // Written in lower case, beside an unknown key, another project's key and code.
  const written = blocker.toLowerCase();
  await page.getByText("Add a description…").click();
  const editor = descriptionBox(page);
  await fillBox(editor, `Waits on ${written}, not ${prefix}-999 or ZZZ-1 or \`${blocker}\`.`);
  await saved(page, () => editor.blur());
  /* The board is read afresh, so the links are drawn from what was saved.
     A board read after a description save shows the old text until a reload
     today, which is a fault of its own. */
  await page.reload();

  const description = page.getByTestId("markdown");
  const link = description.locator("a[data-task-key]");
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText(written);
  await expect(link).toHaveAttribute("href", `/p/${projectId}?task=${blocker}`);
  await expect(description.locator("code")).toHaveText(blocker);

  // A ⌘ or Ctrl click is the browser's: a new tab on the task's own address,
  // and the panel and the description behind it stay as they were.
  const [tab] = await Promise.all([
    page.context().waitForEvent("page"),
    link.click({ modifiers: ["ControlOrMeta"] }),
  ]);
  await expect(tab).toHaveURL(new RegExp(`/p/${projectId}\\?task=${blocker}$`));
  await tab.close();
  await expect(page.getByTestId("task-title")).toHaveValue("The waiting one");
  await expect(editor).toHaveCount(0);

  // A plain click opens the task in the panel with no page load.
  await page.evaluate(() => ((window as unknown as { stayed: boolean }).stayed = true));
  await link.click();
  await expect(page.getByTestId("task-title")).toHaveValue("The blocker");
  await expect(page).toHaveURL(new RegExp(`task=${blocker}$`));
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);

  // A comment links an archived task, and opens its panel.
  await page.getByPlaceholder("Leave a note…").fill(`Done before in ${archived}. See ${waiting}`);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const comment = page.getByTestId("comment-markdown");
  await expect(comment.locator("a[data-task-key]")).toHaveCount(2);
  await comment.getByRole("link", { name: archived }).click();
  await expect(page.getByTestId("task-title")).toHaveValue("Old work");
  await expect(page.getByTestId("archived-row")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`task=${archived}$`));
});
