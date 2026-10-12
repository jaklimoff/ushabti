import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { newProject, renderWithBoard, withTask } from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * A browser fires `open` and then the server's `ready` on every connect. Both
 * used to read the board, so each connect downloaded it twice and threw one
 * copy away. Only `ready` asks, because it comes after the server subscribed.
 */

const settle = () => new Promise((done) => setTimeout(done, 50));

test("a stream connect reads the board once and says it is here once", async () => {
  const data = newProject();
  withTask(data, "Watched", { Status: "Todo" });
  const { sent, open, ready, announced } = await renderWithBoard(
    <BoardShell initialTask={null} />,
    data,
  );
  await expect.element(page.getByTestId("live-dot-off")).toBeVisible();
  await settle();
  const reads = () => sent("GET", /\/board$/).length;
  const before = { reads: reads(), said: announced().length };

  open();
  await expect.element(page.getByTestId("live-dot")).toBeVisible();
  await settle();
  expect(reads()).toBe(before.reads);
  expect(announced().length).toBe(before.said);

  ready();
  await expect.poll(reads).toBe(before.reads + 1);
  await expect.poll(() => announced().length).toBe(before.said + 1);
  await settle();
  expect(reads()).toBe(before.reads + 1);
  expect(announced().length).toBe(before.said + 1);

  /* A reconnect after a blip: one more of each, and no more. */
  ready();
  await expect.poll(reads).toBe(before.reads + 2);
  await expect.poll(() => announced().length).toBe(before.said + 2);
  await settle();
  expect(reads()).toBe(before.reads + 2);
  expect(announced().length).toBe(before.said + 2);
});
