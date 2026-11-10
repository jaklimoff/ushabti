import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { ME, newProject, renderWithBoard, withTask } from "@/test/board";
import { serving } from "@/test/panel";
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

/*
 * A reconnect that meets a 502 while the server restarts closes a source for
 * good, and the tab used to stay silent until somebody reloaded it. It opens a
 * new one after a short wait, and reads on that one's `ready`.
 */
test("a board whose stream is closed for good comes back live", async () => {
  const data = newProject();
  const { sent, open, ready, streams, drop } = await renderWithBoard(
    <BoardShell initialTask={null} />,
    data,
  );
  open();
  ready();
  await expect.element(page.getByTestId("live-dot")).toBeVisible();
  const first = streams();
  expect(first).toHaveLength(1);
  const reads = () => sent("GET", /\/board$/).length;

  drop();
  expect(streams()).toHaveLength(0);
  await expect.poll(streams, { timeout: 4_000 }).toEqual(first);
  const before = reads();

  open();
  ready();
  await expect.element(page.getByTestId("live-dot")).toBeVisible();
  await expect.poll(reads).toBe(before + 1);
});

test("a board read that fails is asked again", async () => {
  const data = newProject();
  withTask(data, "Watched", { Status: "Todo" });
  let failing = true;
  const { sent, ready } = await renderWithBoard(<BoardShell initialTask={null} />, data, (r) =>
    failing && r.method === "GET" && r.path.endsWith("/board")
      ? { status: 503, body: { error: "Restarting." } }
      : undefined,
  );
  const reads = () => sent("GET", /\/board$/).length;
  ready();
  await expect.poll(reads).toBe(1);
  failing = false;
  await expect.poll(reads, { timeout: 4_000 }).toBe(2);
  /* It is owed once: the read that worked asks for nothing more. */
  await new Promise((done) => setTimeout(done, 2_500));
  expect(reads()).toBe(2);
});

/*
 * Every agent step rings the board. A tab nobody is looking at read the whole
 * board for each one; it now reads once, when it is looked at again.
 */
test("a hidden board tab reads nothing on a ring, and reads once when shown", async () => {
  const data = newProject();
  withTask(data, "Watched", { Status: "Todo" });
  const { sent, ring } = await renderWithBoard(<BoardShell initialTask={null} />, data);
  await settle();
  const reads = () => sent("GET", /\/board$/).length;
  const before = reads();

  let state: DocumentVisibilityState = "hidden";
  const looked = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  try {
    for (let i = 0; i < 5; i++) ring();
    await new Promise((done) => setTimeout(done, 2_500));
    expect(reads()).toBe(before);

    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await expect.poll(reads).toBe(before + 1);
    await new Promise((done) => setTimeout(done, 500));
    expect(reads()).toBe(before + 1);
  } finally {
    delete (document as { visibilityState?: unknown }).visibilityState;
    expect(Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState")).toEqual(looked);
  }
});

/* An agent at work rings closer together than the burst, for minutes. */
test("steady rings still read within about two seconds", async () => {
  const data = newProject();
  const { sent, ring } = await renderWithBoard(<BoardShell initialTask={null} />, data);
  await settle();
  const reads = () => sent("GET", /\/board$/).length;
  const before = reads();
  const started = Date.now();
  while (reads() === before && Date.now() - started < 4_000) {
    ring();
    await new Promise((done) => setTimeout(done, 50));
  }
  expect(reads()).toBe(before + 1);
  expect(Date.now() - started).toBeLessThan(2_500);
});

/* An open panel loads the whole of its task. A ring for another task leaves it be. */
test("an open panel ignores a ring that names another task", async () => {
  const data = newProject();
  const open = withTask(data, "Open", { Status: "Todo" });
  const other = withTask(data, "Elsewhere", { Status: "Todo" });
  const server = serving(data, ME);
  const { sent, ring } = await renderWithBoard(
    <BoardShell initialTask={open.key} />,
    data,
    server.answer,
  );
  await expect.element(page.getByTestId("task-panel")).toBeVisible();
  await settle();
  const loads = () => sent("GET", new RegExp(`/api/tasks/${open.id}$`)).length;
  const reads = () => sent("GET", /\/board$/).length;
  const before = { loads: loads(), reads: reads() };
  expect(before.loads).toBeGreaterThan(0);

  ring(other.id);
  await expect.poll(reads).toBe(before.reads + 1);
  await new Promise((done) => setTimeout(done, 300));
  expect(loads()).toBe(before.loads);

  ring(open.id);
  await expect.poll(loads).toBe(before.loads + 1);

  /* A ring that names nothing may be about anything. */
  ring();
  await expect.poll(loads).toBe(before.loads + 2);
});
