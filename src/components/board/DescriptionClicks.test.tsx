import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ME, newProject, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * A click the page answers itself — a link, a video, a details summary, or
 * the end of a drag that selected words — never opens the description's
 * editor. A plain click on the words still does.
 */

const byTestId = (id: string) => page.getByTestId(id);
const address = window.location.href;

/* The test runs in a frame; a followed link would load another page into
   it. The click still runs every handler on the page first. */
const stay = (e: Event) => {
  if ((e.target as Element).closest?.("a")) e.preventDefault();
};
beforeEach(() => window.addEventListener("click", stay, true));
afterEach(() => {
  window.removeEventListener("click", stay, true);
  window.getSelection()?.removeAllRanges();
  window.history.replaceState(null, "", address);
});

const editorClosed = () => expect(byTestId("live-editor").elements()).toHaveLength(0);

async function open(description: string) {
  const data = newProject();
  const task = withTask(data, "Read me", { Status: "Todo" });
  task.description = description;
  const server = serving(data, ME, []);
  await renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer);
  window.history.replaceState(null, "", address);
  const words = byTestId("markdown");
  await expect.element(words).toBeVisible();
  return words.element() as HTMLElement;
}

test("a drag that selects words leaves the editor closed and the selection in place", async () => {
  const words = await open("The **first words** and then the *last words* of it.");
  const from = words.querySelector("strong")!;
  const to = words.querySelector("em")!;
  await userEvent.dragAndDrop(from, to);
  const said = window.getSelection()!.toString();
  expect(said.trim().length).toBeGreaterThan(0);
  await settled();
  editorClosed();
  expect(window.getSelection()!.toString()).toBe(said);
});

const boxOf = (words: HTMLElement) => words.closest('[role="button"]') as HTMLElement;

/* A first click on the words waits for a second one before it opens the
   editor, so a test that expects it closed waits that long too. */
const settled = () => new Promise((done) => setTimeout(done, 500));

test("a drag from the words into the box's padding leaves the editor closed and the selection in place", async () => {
  const words = await open("The **first words** and then the *last words* of it.");
  const box = boxOf(words);
  const { width, height } = box.getBoundingClientRect();
  await userEvent.dragAndDrop(words.querySelector("strong")!, box, {
    targetPosition: { x: width / 2, y: height - 4 },
  });
  const said = window.getSelection()!.toString();
  expect(said).toContain("words and then the");
  await settled();
  editorClosed();
  expect(window.getSelection()!.toString()).toBe(said);
});

test("a drag from the words out past the box leaves the editor closed and the selection in place", async () => {
  const words = await open("The **first words** and then the *last words* of it.");
  // The block's own head, above the box: the release lands outside it.
  await userEvent.dragAndDrop(words.querySelector("em")!, page.getByText("Click to edit"));
  const said = window.getSelection()!.toString();
  expect(said.trim().length).toBeGreaterThan(0);
  await settled();
  editorClosed();
  expect(window.getSelection()!.toString()).toBe(said);
});

test("a double click that selects a word leaves the editor closed", async () => {
  const words = await open("Just **some** words.");
  await userEvent.dblClick(words.querySelector("strong")!);
  expect(window.getSelection()!.toString().trim()).toBe("some");
  await settled();
  editorClosed();
  expect(window.getSelection()!.toString().trim()).toBe("some");
});

test("a click on the box's padding with nothing selected opens the editor", async () => {
  const words = await open("Just **some** words.");
  await userEvent.click(boxOf(words), { position: { x: 3, y: 3 } });
  await expect.element(byTestId("live-editor")).toBeVisible();
});

test("a press outside the box before a click on the words opens the editor leaves it closed", async () => {
  const words = await open("Just **some** words.");
  await userEvent.click(words.querySelector("strong")!);
  /* Sent at once, inside the wait: a second click through the driver may
     arrive after it. */
  byTestId("task-title")
    .element()
    .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
  await settled();
  editorClosed();
});

test("a click on an ordinary link or a file's link leaves the editor closed", async () => {
  const words = await open(
    'See [the site](https://example.com) and <a href="/api/attachments/0b6c1f7e-2d3a-4e5f-8a9b-1c2d3e4f5a6b">notes.pdf</a>.',
  );
  await userEvent.click(words.querySelector('a[href="https://example.com"]')!);
  await settled();
  editorClosed();
  await userEvent.click(
    words.querySelector('a[href="/api/attachments/0b6c1f7e-2d3a-4e5f-8a9b-1c2d3e4f5a6b"]')!,
  );
  editorClosed();
});

test("a press on a video or a details summary leaves the editor closed", async () => {
  const words = await open(
    'A clip:\n\n<video controls src="/api/attachments/0b6c1f7e-2d3a-4e5f-8a9b-1c2d3e4f5a6b"></video>\n\n<details><summary>More</summary>\n\nHidden words.\n\n</details>',
  );
  const video = words.querySelector("video");
  expect(video).not.toBeNull();
  await userEvent.click(video!);
  await settled();
  editorClosed();
  const details = words.querySelector("details")!;
  await userEvent.click(details.querySelector("summary")!);
  editorClosed();
  await settled();
  editorClosed();
  expect(details.open).toBe(true);
});

test("Enter on a focused link leaves the editor closed", async () => {
  const words = await open("See [the site](https://example.com) for more.");
  const link = words.querySelector("a")!;
  link.focus();
  await userEvent.keyboard("{Enter}");
  await settled();
  editorClosed();
});

test("a plain click on the words, and Enter on the description, open the editor", async () => {
  const words = await open("Just **some** words.");
  await userEvent.click(words.querySelector("strong")!);
  await expect.element(byTestId("live-editor")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => byTestId("live-editor").elements().length).toBe(0);
  const box = byTestId("markdown").element().closest('[role="button"]') as HTMLElement;
  box.focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(byTestId("live-editor")).toBeVisible();
});
