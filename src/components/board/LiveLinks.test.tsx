import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { AttachmentDTO } from "@/lib/types";
import { DOUBLE_CLICK_MS } from "@/lib/live-markdown";
import { detailOf, newProject, renderWithBoard, withTask } from "@/test/board";
import { fillBox, liveValue, serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * A link drawn in a live box opens with a plain click, as it does on the
 * page, and the caret stays where it was. On the caret's line a link is its
 * source, so a click there edits. The three boxes are one editor, so each
 * is asked once.
 */

const FILE = "0a1b2c3d-0000-4000-8000-00000000000f";
const TEXT = `see [the docs](https://example.com/docs) and TST-2\nor https://example.com/bare\n![plan](/api/attachments/${FILE})\nlast line`;

const byTestId = (id: string) => page.getByTestId(id);
const inBox = (testId: string, selector: string) => [
  ...byTestId(testId).element().querySelectorAll<HTMLElement>(selector),
];
const drawnLink = (testId: string, words: string) => {
  const found = inBox(testId, "[data-lp-open]").find((el) => el.textContent?.includes(words));
  if (!found) throw new Error(`No link in ${testId} reads ${words}.`);
  return found;
};

/** Where the box's caret is, as CodeMirror holds it. */
function caret(testId: string): { anchor: number; head: number } {
  const el = byTestId(testId).element() as unknown as {
    cmTile?: {
      root?: { view?: { state: { selection: { main: { anchor: number; head: number } } } } };
    };
  };
  const { anchor, head } = el.cmTile!.root!.view!.state.selection.main;
  return { anchor, head };
}

/** Long enough for a click to be no double click, and so to open. */
const waitOpen = () => new Promise((resolve) => setTimeout(resolve, DOUBLE_CLICK_MS + 150));

let opened: MockInstance<typeof window.open>;
beforeEach(() => {
  opened = vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => {
  opened.mockRestore();
});

async function openPanel() {
  const data = newProject();
  const task = withTask(data, "Links inside", { Status: "Todo" });
  withTask(data, "The other one", { Status: "Todo" });
  const server = serving(data);
  const pdf: AttachmentDTO = {
    id: FILE,
    taskId: task.id,
    uploaderId: null,
    name: "plan.pdf",
    mime: "application/pdf",
    size: 2048,
    width: null,
    height: null,
    createdAt: new Date().toISOString(),
    url: `/api/attachments/${FILE}`,
  };
  const drawn = await renderWithBoard(<BoardShell initialTask={task.key} />, data, (sent) => {
    if (sent.method === "GET" && sent.path === `/api/tasks/${task.id}`) {
      return { body: { task: detailOf(server.taskOf(task.id)!, { attachments: [pdf] }) } };
    }
    return server.answer(sent);
  });
  return { ...drawn, ...server, task };
}

/** The description box open, holding the links, with the caret on the last line. */
async function description() {
  const opened = await openPanel();
  await page.getByText("Add a description…").click();
  await fillBox(TEXT);
  await expect.poll(() => inBox("live-editor", "[data-lp-open]").length).toBe(4);
  return opened;
}

describe("A click on a link in a live box", () => {
  test("opens a link and a bare address in a new tab, and leaves the caret", async () => {
    await description();
    const before = caret("live-editor");

    await userEvent.click(drawnLink("live-editor", "the docs"));
    await waitOpen();
    expect(opened).toHaveBeenCalledWith(
      "https://example.com/docs",
      "_blank",
      "noopener,noreferrer",
    );
    expect(caret("live-editor")).toEqual(before);
    // The line still reads rendered: the caret did not land on it.
    expect(byTestId("live-editor").element().textContent).not.toContain("](");

    await userEvent.click(drawnLink("live-editor", "example.com/bare"));
    await waitOpen();
    expect(opened).toHaveBeenLastCalledWith(
      "https://example.com/bare",
      "_blank",
      "noopener,noreferrer",
    );
    expect(caret("live-editor")).toEqual(before);
    expect(getComputedStyle(drawnLink("live-editor", "the docs")).cursor).toBe("pointer");
  });

  test("opens a file drawn as a download", async () => {
    await description();
    const before = caret("live-editor");
    await userEvent.click(drawnLink("live-editor", "plan.pdf"));
    await waitOpen();
    expect(opened).toHaveBeenCalledWith(
      `${location.origin}/api/attachments/${FILE}`,
      "_blank",
      "noopener,noreferrer",
    );
    expect(caret("live-editor")).toEqual(before);
  });

  test("opens a task key in the panel", async () => {
    await description();
    await userEvent.click(drawnLink("live-editor", "TST-2"));
    await expect.element(byTestId("task-title")).toHaveValue("The other one");
    expect(opened).not.toHaveBeenCalled();
  });

  test("a key saves the words typed on this task, and the next one opens without them", async () => {
    const { sent, task } = await description();
    await userEvent.click(drawnLink("live-editor", "TST-2"));
    await expect.element(byTestId("task-title")).toHaveValue("The other one");

    const patches = sent().filter((s) => s.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe(`/api/tasks/${task.id}`);
    expect(patches[0].body).toMatchObject({ description: TEXT });
    // The other task's description is its own, empty, and not being edited.
    await expect.poll(() => byTestId("live-editor").elements().length).toBe(0);
    await expect.element(page.getByText("Add a description…")).toBeVisible();
  });

  test("on the caret's line a click puts the caret and opens nothing", async () => {
    await description();
    // The caret goes to the first line, which shows its source.
    const box = byTestId("live-editor").element() as HTMLElement;
    box.focus();
    await userEvent.keyboard("{ControlOrMeta>}{Home}{/ControlOrMeta}");
    await expect.poll(() => inBox("live-editor", ".cm-line")[0].textContent).toContain("](");
    expect(inBox("live-editor", ".cm-line")[0].querySelector("[data-lp-open]")).toBe(null);

    const docs = inBox("live-editor", ".cm-lp-link").find((el) =>
      el.textContent?.includes("docs"),
    )!;
    await userEvent.click(docs);
    await waitOpen();
    expect(opened).not.toHaveBeenCalled();
    expect(caret("live-editor").head).toBeGreaterThan(0);
    expect(caret("live-editor").head).toBeLessThan(TEXT.indexOf("\n"));
  });

  test("a click with a modifier, a drag and a double click open nothing", async () => {
    await description();

    await userEvent.click(drawnLink("live-editor", "the docs"), { modifiers: ["Shift"] });
    await waitOpen();
    expect(opened).not.toHaveBeenCalled();

    // Back to the last line, so the first one is drawn again.
    (byTestId("live-editor").element() as HTMLElement).focus();
    await userEvent.keyboard("{ControlOrMeta>}{End}{/ControlOrMeta}");
    await expect.poll(() => inBox("live-editor", "[data-lp-open]").length).toBe(4);

    await userEvent.dragAndDrop(
      byTestId("live-editor").element().querySelector("[data-lp-open]")!,
      inBox("live-editor", ".cm-line")[1],
    );
    await waitOpen();
    expect(opened).not.toHaveBeenCalled();
    const { anchor, head } = caret("live-editor");
    expect(anchor).not.toBe(head);

    (byTestId("live-editor").element() as HTMLElement).focus();
    await userEvent.keyboard("{ControlOrMeta>}{End}{/ControlOrMeta}");
    await expect.poll(() => inBox("live-editor", "[data-lp-open]").length).toBe(4);

    await userEvent.dblClick(drawnLink("live-editor", "the docs"));
    await waitOpen();
    expect(opened).not.toHaveBeenCalled();
    const word = caret("live-editor");
    expect(liveValue("live-editor").slice(word.anchor, word.head)).toMatch(/^(the|docs)$/);
  });

  test("the comment composer opens a link the same way", async () => {
    await openPanel();
    await fillBox("see [the docs](https://example.com/docs)\nlast", "comment-box");
    await expect.poll(() => inBox("comment-box", "[data-lp-open]").length).toBe(1);
    const before = caret("comment-box");
    await userEvent.click(drawnLink("comment-box", "the docs"));
    await waitOpen();
    expect(opened).toHaveBeenCalledWith(
      "https://example.com/docs",
      "_blank",
      "noopener,noreferrer",
    );
    expect(caret("comment-box")).toEqual(before);
  });

  test("a key in the composer posts nothing, and leaves the note with its own task", async () => {
    const { sent } = await openPanel();
    await fillBox("ask TST-2 about it\nlast", "comment-box");
    await expect.poll(() => inBox("comment-box", "[data-lp-open]").length).toBe(1);
    await userEvent.click(drawnLink("comment-box", "TST-2"));
    await expect.element(byTestId("task-title")).toHaveValue("The other one");
    await expect.poll(() => liveValue("comment-box")).toBe("");
    expect(sent("POST").filter((s) => s.path.endsWith("/comments"))).toHaveLength(0);
  });

  test("the comment edit opens a task key the same way", async () => {
    await openPanelWithComment();
    await byTestId("comment").hover();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(byTestId("comment-editor")).toBeVisible();
    await fillBox("ask TST-2 about it\nlast", "comment-editor");
    await expect.poll(() => inBox("comment-editor", "[data-lp-open]").length).toBe(1);
    await userEvent.click(drawnLink("comment-editor", "TST-2"));
    await expect.element(byTestId("task-title")).toHaveValue("The other one");
  });
});

async function openPanelWithComment() {
  const data = newProject();
  const task = withTask(data, "Links inside", { Status: "Todo" });
  withTask(data, "The other one", { Status: "Todo" });
  const server = serving(data);
  server.comment(task, "A note");
  await renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer);
  await expect.element(byTestId("comment-markdown")).toHaveTextContent("A note");
}
