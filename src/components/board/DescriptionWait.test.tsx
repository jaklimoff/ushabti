import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { boxValue, serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * The description is always its editor, and the editor is a chunk of its
 * own. Until the chunk lands the box draws the saved words rendered, in the
 * same box, so the editor that takes its place moves nothing under it. The
 * chunk is held here until the test lets it go.
 */

const chunk = vi.hoisted(() => {
  let open = () => {};
  const landed = new Promise<void>((done) => (open = done));
  return { landed, open: () => open() };
});
vi.mock("./LiveEditor", async (original) => {
  await chunk.landed;
  return original();
});

const byTestId = (id: string) => page.getByTestId(id);

/** The box and what is under it, measured from the top of the block. */
function measure(box: Element, block: Element) {
  const top = block.getBoundingClientRect().top;
  const r = box.getBoundingClientRect();
  const under = (block.nextElementSibling as HTMLElement).getBoundingClientRect().top;
  return { top: r.top - top, height: r.height, under: under - top };
}

/** Waits until the panel has stopped moving: the task's read lands late. */
async function still(read: () => unknown) {
  const frame = () => new Promise((done) => requestAnimationFrame(done));
  let was = JSON.stringify(read());
  for (let i = 0; i < 60; i++) {
    for (let f = 0; f < 5; f++) await frame();
    const now = JSON.stringify(read());
    if (now === was) return;
    was = now;
  }
}

test("the words are drawn in the box before the editor lands, and it moves nothing", async () => {
  const data = newProject();
  const task = withTask(data, "Read me first", { Status: "Todo" });
  task.description = "## Plan\n\nSome **bold** words and a list:\n\n- one\n- two\n\nThe end.";
  const server = serving(data);
  await renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer);

  const waiting = byTestId("live-editor-wait");
  await expect.element(waiting.getByTestId("markdown")).toBeVisible();
  await expect.element(waiting.getByRole("heading", { name: "Plan" })).toBeVisible();
  expect(page.getByText("Click to edit").elements()).toHaveLength(0);

  const box = waiting.element() as HTMLElement;
  const block = box.parentElement!;
  await still(() => measure(box, block));
  const before = measure(box, block);

  // A press before the editor is here is a press on the box.
  await userEvent.click(waiting.getByText("The end."));

  chunk.open();
  const editor = byTestId("live-editor");
  await expect.element(editor).toHaveFocus();
  expect(byTestId("live-editor-wait").elements()).toHaveLength(0);
  expect(boxValue()).toBe(task.description);
  // The caret is where the press was, in the last line's words.
  const caret = window.getSelection()!;
  expect(caret.anchorNode?.textContent).toContain("The end.");

  // Out of the box, every line is drawn again, and the box is where it was.
  (editor.element() as HTMLElement).blur();
  await expect.element(editor).not.toHaveFocus();
  const host = editor.element().closest(".cm-editor")!.parentElement!;
  expect(host.parentElement).toBe(block);
  const after = measure(host, block);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.under - before.under)).toBeLessThanOrEqual(2);
});
