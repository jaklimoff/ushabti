import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ME, newProject, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * A key written in a description or a comment is a link to that task. A plain
 * click opens it in the panel, as a search hit does, and the href is the
 * task's own address for a copy or a ⌘ click. This was the test of
 * `e2e/task-keys.spec.ts`, and its name is the name it had there. Which words
 * are a key is `task-keys.test.ts`; this is the page drawing that rule.
 */

const byTestId = (id: string) => page.getByTestId(id);

/* The panel writes the task it opens into the address, which is the frame
   the test runs in. */
const address = window.location.href;
afterEach(() => {
  window.history.replaceState(null, "", address);
});

test("a key in a description and in a comment opens its task", async () => {
  const data = newProject();
  const old = withTask(data, "Old work", { Status: "Done" });
  const blocker = withTask(data, "The blocker", { Status: "Todo" });
  const waiting = withTask(data, "The waiting one", { Status: "Todo" });
  data.tasks = data.tasks.filter((t) => t !== old);
  old.archivedAt = "2026-10-07T09:00:00.000Z";
  // The board carries an archived task's name; a read of it answers the rest.
  data.archived.push({
    id: old.id,
    number: old.number,
    key: old.key,
    title: old.title,
    description: old.description,
    position: old.position,
    archivedAt: old.archivedAt,
  });
  const prefix = blocker.key.split("-")[0];

  // Written in lower case, beside an unknown key, another project's key and
  // code, and saved: the board draws the links from what was saved.
  const written = blocker.key.toLowerCase();
  waiting.description = `Waits on ${written}, not ${prefix}-999 or ZZZ-1 or \`${blocker.key}\`.`;
  const server = serving(data, ME, [old]);
  await renderWithBoard(<BoardShell initialTask={waiting.key} />, data, server.answer);
  window.history.replaceState(null, "", address);

  const description = byTestId("markdown");
  await expect.element(description.getByRole("link")).toBeVisible();
  const links = () => description.element().querySelectorAll("a[data-task-key]");
  expect(links()).toHaveLength(1);
  const link = links()[0] as HTMLAnchorElement;
  expect(link.textContent).toBe(written);
  expect(link.getAttribute("href")).toBe(`/p/${data.project.id}?task=${blocker.key}`);
  await expect.element(description.element().querySelector("code")!).toHaveTextContent(blocker.key);

  // A ⌘ or Ctrl click is the browser's: a new tab on the task's own address,
  // and the panel and the description behind it stay as they were.
  await userEvent.click(link, { modifiers: ["ControlOrMeta"] });
  expect(window.location.search).not.toMatch(/task=/);
  await expect.element(byTestId("task-title")).toHaveValue("The waiting one");
  expect(byTestId("live-editor").elements()).toHaveLength(0);

  // A plain click opens the task in the panel with no page load.
  await userEvent.click(link);
  await expect.element(byTestId("task-title")).toHaveValue("The blocker");
  expect(window.location.search).toMatch(new RegExp(`task=${blocker.key}$`));

  // A comment links an archived task, and opens its panel.
  await byTestId("card").filter({ hasText: "The waiting one" }).click();
  await expect.element(byTestId("task-title")).toHaveValue("The waiting one");
  await page
    .getByPlaceholder("Leave a note…")
    .fill(`Done before in ${old.key}. See ${waiting.key}`);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const comment = byTestId("comment-markdown");
  await expect.poll(() => comment.element().querySelectorAll("a[data-task-key]").length).toBe(2);
  await comment.getByRole("link", { name: old.key }).click();
  await expect.element(byTestId("task-title")).toHaveValue("Old work");
  await expect.element(byTestId("archived-row")).toBeVisible();
  expect(window.location.search).toMatch(new RegExp(`task=${old.key}$`));
});
