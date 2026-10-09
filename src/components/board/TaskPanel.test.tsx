import { describe, expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import type { BoardData, CommentDTO, TaskDTO } from "@/lib/types";
import { detailOf, ME, newProject, renderWithBoard, withTask, type Answer } from "@/test/board";
import { BoardShell } from "./BoardApp";

/*
 * What the task panel does with an edit nobody finished: a box left with
 * Escape, a note on a tab that closed, a title the tab closed on, and the
 * width somebody dragged it to. Each test here was a test of
 * `e2e/board.spec.ts`, and its name is the name it had there. A reload there
 * is a second drawing here, which keeps what this browser stored.
 */

const TASK = /^\/api\/tasks\/[0-9a-f-]+$/;
const COMMENTS = /^\/api\/tasks\/[0-9a-f-]+\/comments$/;

const byTestId = (id: string) => page.getByTestId(id);

/**
 * The server, as far as the panel reads it: the board, the one task, and the
 * comments sent on it. It holds a copy of the board, because the store was
 * handed `data`, and a change made to that in place would be one nobody wrote.
 */
function serving(data: BoardData, task: TaskDTO): { answer: Answer; server: BoardData } {
  const server = structuredClone(data);
  const comments: CommentDTO[] = [];
  const answer: Answer = ({ method, path, body }) => {
    if (method === "GET" && path.endsWith("/board")) return { body: server };
    if (method === "POST" && COMMENTS.test(path)) {
      comments.push({
        id: `00000000-0000-4000-8000-7${String(comments.length).padStart(11, "0")}`,
        body: (body as { body: string }).body,
        createdAt: "2026-10-08T10:00:00.000Z",
        editedAt: null,
        byProject: false,
        author: { id: ME.id, name: ME.name, color: ME.color, emoji: null, kind: "human" },
      } as CommentDTO);
      return { body: {} };
    }
    if (method === "GET" && path === `/api/tasks/${task.id}`) {
      const now = server.tasks.find((t) => t.id === task.id)!;
      return { body: { task: detailOf(now, { comments: [...comments] }) } };
    }
  };
  return { answer, server };
}

async function draw(data: BoardData, task: TaskDTO, keepStorage = false) {
  const { answer, server } = serving(data, task);
  const drawn = await renderWithBoard(<BoardShell initialTask={task.key} />, data, answer, {
    keepStorage,
  });
  return { ...drawn, server };
}

/** The writes of the task itself, which a read of it is not. */
const taskWrites = (sent: Awaited<ReturnType<typeof draw>>["sent"]) =>
  sent().filter((r) => r.method !== "GET" && TASK.test(r.path));

/** The words the live editor holds, as they will be saved. */
function boxValue(): string {
  const el = byTestId("live-editor").element() as unknown as {
    cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } };
  };
  const view = el.cmTile?.root?.view;
  if (!view) throw new Error("The description box is not a CodeMirror editor.");
  return view.state.doc.toString();
}

/** The e2e helper `fillBox`: everything in the box, replaced by these words. */
async function fillBox(text: string) {
  /* The editor is a lazy chunk, so the click that opens it draws it later. */
  await expect.element(byTestId("live-editor")).toBeInTheDocument();
  (byTestId("live-editor").element() as HTMLElement).focus();
  await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}");
  await userEvent.keyboard(text);
  await expect.poll(boxValue).toBe(text);
}

const panelWidth = () => Math.round(byTestId("task-panel").element().getBoundingClientRect().width);

describe("The task panel", () => {
  test("Escape throws the edit away and writes nothing", async () => {
    const data = newProject();
    const task = withTask(data, "Keep the old title", { Status: "Todo" });
    // Something worth losing: a description that is already saved.
    task.description = "The words that were saved.";
    const { sent } = await draw(data, task);

    const markdown = byTestId("markdown");
    await expect.element(markdown).toHaveTextContent("The words that were saved.");

    await markdown.click();
    await fillBox("Words nobody asked to keep.");
    await userEvent.keyboard("{Escape}");
    await expect.element(byTestId("markdown")).toHaveTextContent("The words that were saved.");

    const title = byTestId("task-title");
    await title.click();
    await title.fill("A title nobody asked to keep");
    await userEvent.keyboard("{Escape}");

    // A write would already be in flight; give it the chance to go out.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(taskWrites(sent)).toEqual([]);
    await expect.element(byTestId("task-title")).toHaveValue("Keep the old title");
    await expect.element(byTestId("markdown")).toHaveTextContent("The words that were saved.");
  });

  /*
   * A field saves when you leave it, and a tab closed on one sends what the
   * blur would have sent. A comment cannot be sent that way — nobody wrote it
   * yet — so the words wait in the browser instead.
   */
  test("a half-written note survives a closed tab, and sending it clears the draft", async () => {
    const data = newProject();
    const task = withTask(data, "Long note", { Status: "Todo" });
    const note = "The queue drops a message when the worker restarts mid-batch.";

    const first = await draw(data, task);
    await page.getByPlaceholder("Leave a note…").fill(note);
    // In the browser, where the next tab reads it, and nowhere else.
    expect(Object.values({ ...window.localStorage })).toContain(note);
    expect(first.sent("POST", COMMENTS)).toEqual([]);
    await first.screen.unmount();

    const back = await draw(data, task, true);
    await expect.element(page.getByPlaceholder("Leave a note…")).toHaveValue(note);
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect.poll(() => back.sent("POST", COMMENTS).length).toBe(1);
    expect(back.sent("POST", COMMENTS)[0].body).toEqual({ body: note });
    await expect.element(byTestId("comment-markdown")).toHaveTextContent(note);
    await back.screen.unmount();

    // Sent is not unsaid: there is nothing left to put back.
    expect(Object.values({ ...window.localStorage })).not.toContain(note);
    await draw(data, task, true);
    await expect.element(page.getByPlaceholder("Leave a note…")).toHaveValue("");
  });

  test("the panel is as wide as somebody dragged it, and stays that wide", async () => {
    const data = newProject();
    const task = withTask(data, "Room to read", { Status: "Todo" });
    const first = await draw(data, task);

    await expect.element(byTestId("task-panel")).toBeVisible();
    const was = panelWidth();
    const edge = byTestId("panel-grip").element().getBoundingClientRect();

    // The panel grows to the left, so the pointer goes left.
    const x = edge.x + edge.width / 2;
    await commands.drag({ x, y: edge.y + 240 }, { x: x - 140, y: edge.y + 240 });
    await expect.poll(panelWidth).toBe(Math.round(was + 140));

    // The arrow keys move it too, so the width is not a mouse-only setting.
    (byTestId("panel-grip").element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(panelWidth).toBe(Math.round(was + 156));

    // The next board this person opens is the width they left it.
    await first.screen.unmount();
    await draw(data, task, true);
    await expect.element(byTestId("task-panel")).toBeVisible();
    await expect.poll(panelWidth).toBe(Math.round(was + 156));
  });
});

/*
 * A field saves on blur, and a tab closed on a focused field sends no blur.
 * The save goes out on the way off the page instead. A page that is going
 * does not report that request to Playwright, so end to end could only read
 * the next page; here the request itself is counted.
 */
describe("An edit the tab was closed on", () => {
  test("the task title is saved although nothing was blurred", async () => {
    const data = newProject();
    const task = withTask(data, "The old title", { Status: "Todo" });
    const { sent } = await draw(data, task);

    const title = byTestId("task-title");
    await title.click();
    await title.fill("The words the tab took");

    // No Enter, no Escape, no click elsewhere: the tab goes while the field
    // still has the focus, which is the blur the browser never sends.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await expect.poll(() => taskWrites(sent).length).toBe(1);
    expect(taskWrites(sent)[0].body).toMatchObject({ title: "The words the tab took" });
    // Only a keepalive request outlives the page that sent it.
    const leave = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          TASK.test(new URL(String(url), location.origin).pathname) && init?.keepalive,
      );
    expect(leave?.[1]?.method).toBe("PATCH");
  });

  /*
   * A click is not an edit. The box seeds a draft from the title, and that
   * draft goes stale the moment an agent or another person renames the task —
   * which on this board is the ordinary case, not the rare one. Closing the
   * tab on it must not put the old name back.
   */
  test("a title clicked into but not typed in writes nothing back", async () => {
    const data = newProject();
    const task = withTask(data, "The first name", { Status: "Todo" });
    const { sent, ring, server } = await draw(data, task);

    // The cursor sits in the title, and nothing is typed.
    await byTestId("task-title").click();

    // Somebody else renames the task, and this tab hears about it.
    const renamed = "The name that has to stand";
    server.tasks = server.tasks.map((t) => (t.id === task.id ? { ...t, title: renamed } : t));
    ring();

    /* The tab that typed nothing draws the new name, cursor and all. This is
       the assertion with the teeth: a box that still drew the old name would
       be holding exactly the words a leave would send. */
    await expect.element(byTestId("task-title")).toHaveValue(renamed);

    // Nobody typed in this tab, so closing it writes nothing.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(taskWrites(sent)).toEqual([]);
  });
});
