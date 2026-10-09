import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import type { AttachmentDTO } from "@/lib/types";
import { detailOf, newProject, renderWithBoard, withTask } from "@/test/board";
import { boxValue, serving } from "@/test/panel";
import { BoardShell } from "./BoardApp";

/*
 * A file dropped on the description, and a line a stopped upload left in a
 * draft. Each test here was a test of `e2e/upload.spec.ts`, and its name is
 * the name it had there. The routes and the bucket are answered here, which
 * proves what the box writes and draws; the two uploads through a real bucket
 * stayed end to end, and the routes are `attachments-route.test.ts`.
 */

const UPLOAD = "00000000-0000-4000-8000-cccccccccccc";
const LINE = `![pixel.png](/api/attachments/${UPLOAD})`;

/* The bucket takes a PUT at once. The file goes there by XMLHttpRequest. */
class Bucket {
  status = 0;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  abort() {
    this.onabort?.();
  }
  send() {
    setTimeout(() => {
      this.status = 200;
      this.onload?.();
    }, 10);
  }
}

const byTestId = (id: string) => page.getByTestId(id);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Uploads", () => {
  test("the description takes a dropped file in the same box", async () => {
    const data = newProject();
    const task = withTask(data, "Described with a picture", { Status: "Todo" });
    const server = serving(data);
    let ready: AttachmentDTO | null = null;
    // Stubbed before the board, which stubs fetch, so the board's stubs are kept.
    vi.stubGlobal("XMLHttpRequest", Bucket);
    await renderWithBoard(<BoardShell initialTask={task.key} />, data, (sent) => {
      if (sent.method === "POST" && sent.path === `/api/tasks/${task.id}/attachments`)
        return { status: 201, body: { id: UPLOAD, uploadUrl: "/stub-bucket", headers: {} } };
      if (sent.method === "POST" && sent.path === `/api/attachments/${UPLOAD}/ready`) {
        ready = {
          id: UPLOAD,
          taskId: task.id,
          uploaderId: null,
          name: "pixel.png",
          mime: "image/png",
          size: 70,
          width: 1,
          height: 1,
          createdAt: new Date().toISOString(),
          url: `/api/attachments/${UPLOAD}`,
        } as AttachmentDTO;
        return { body: { attachment: ready } };
      }
      // Once the file is in, a read of the task carries it.
      if (sent.method === "GET" && sent.path === `/api/tasks/${task.id}` && ready)
        return {
          body: { task: detailOf(server.taskOf(task.id)!, { attachments: [ready] }) },
        };
      return server.answer(sent);
    });

    await page.getByText("Add a description…").click();
    const editor = byTestId("live-editor");
    await expect.element(editor).toHaveFocus();
    const files = new DataTransfer();
    files.items.add(new File([new Uint8Array([1, 2, 3])], "pixel.png", { type: "image/png" }));
    editor
      .element()
      .dispatchEvent(
        new DragEvent("drop", { dataTransfer: files, bubbles: true, cancelable: true }),
      );
    await expect.poll(boxValue).toBe(LINE);

    (editor.element() as HTMLElement).blur();
    await expect.poll(() => server.taskOf(task.id)!.description).toBe(LINE);
    await expect
      .element(byTestId("markdown").getByRole("img"))
      .toHaveAttribute("src", `/api/attachments/${UPLOAD}`);
    await expect.poll(() => byTestId("files").getByTestId("file").elements().length).toBe(1);
  });

  test("a line a stopped upload left in the composer draft is not shown again", async () => {
    const data = newProject();
    const task = withTask(data, "Left a line", { Status: "Todo" });
    const server = serving(data);
    const first = await renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer);

    // The draft a tab closed mid-upload leaves behind: the words and the line.
    const box = () => byTestId("comment-box");
    await box().fill("Kept words\nUploading shot.png… 40%");
    await expect.element(box()).toHaveValue("Kept words");
    await first.screen.unmount();

    // The same tab, back on the board: the draft is what this browser kept.
    await renderWithBoard(<BoardShell initialTask={task.key} />, data, server.answer, {
      keepStorage: true,
    });
    await expect.element(box()).toHaveValue("Kept words");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect.element(byTestId("comment-markdown")).toHaveTextContent("Kept words");
  });
});
