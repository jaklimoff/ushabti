/* eslint-disable playwright/no-skipped-test -- a server with no bucket cannot run these, and says so. */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addTask, createProject, register, unique, hydrated } from "./helpers";

/**
 * A file dropped on the markdown box uploads, says how far it got where the
 * cursor was, and becomes its markdown. These need a bucket, so a server with
 * no S3_BUCKET skips them; USH-181 brings an object store to CI and to the dev
 * stack. The routes themselves are tested with the bucket stubbed, in
 * `attachments-route.test.ts`, and the description's drop and the draft a
 * stopped upload left are `Upload.test.tsx`.
 */

// A real 1×1 PNG: the ready route reads an image's size from its bytes.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
// A video's bytes are not read, only its mime and its length.
const MP4 = btoa("not really a video, but the bucket does not look");
const LINE = /^!\[pixel\.png\]\(\/api\/attachments\/[0-9a-f-]{36}\)$/;

type Dropped = { name: string; mime: string; base64: string };

async function drop(page: Page, target: Locator, files: Dropped[]) {
  const dataTransfer = await page.evaluateHandle((files) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.mime }));
    }
    return dt;
  }, files);
  await target.dispatchEvent("drop", { dataTransfer });
}

/* On, the route finds no such task; off, it says files are off. Anything
   else is a server that cannot store a file either. */
async function filesOn(page: Page): Promise<boolean> {
  const answer = await page.request.get(`/api/tasks/${crypto.randomUUID()}/attachments`);
  const said = await answer.json().catch(() => null);
  return answer.status() === 404 && said?.error === "Task not found.";
}

const NO_BUCKET = "This server has no S3_BUCKET set, so there is no bucket to upload to.";

test("a PNG dropped on the composer uploads with a line, and becomes an image in the comment", async ({
  page,
}) => {
  await register(page, "Owner Person");
  await createProject(page, unique("Files"));
  test.skip(!(await filesOn(page)), NO_BUCKET);
  await addTask(page, "Todo", "Shows a picture");

  // The bucket waits until the line has been seen, so a small file cannot outrun it.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  // The bucket is wherever the server signed the PUT for: any origin but the board's.
  const board = new URL(page.url()).origin;
  await page.route(
    (url) => url.origin !== board,
    async (route) => {
      if (route.request().method() === "PUT") await held;
      await route.continue();
    },
  );

  const composer = page.getByTestId("comment-box");
  // A drop before React owns the box lands on nothing that listens.
  await hydrated(composer);
  await drop(page, composer, [{ name: "pixel.png", mime: "image/png", base64: PNG }]);
  await expect(composer).toHaveValue(/^Uploading pixel\.png… \d+%$/);
  const send = page.getByRole("button", { name: "Uploading…" });
  await expect(send).toBeDisabled();
  release();

  await expect(composer).toHaveValue(LINE);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const image = page.getByTestId("comment-markdown").locator("img");
  await expect(image).toHaveAttribute("src", /^\/api\/attachments\/[0-9a-f-]{36}$/);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

  const files = page.getByTestId("files");
  await expect(files.getByTestId("file")).toHaveCount(1);
  await expect(files.getByTestId("file")).toContainText("pixel.png");
  await expect(files.getByTestId("file")).toContainText("bytes");
  await expect(files.getByRole("link", { name: /pixel\.png/ })).toHaveAttribute("target", "_blank");
});

test("a video draws a player, a refused file says why, and the strip removes one", async ({
  page,
}) => {
  await register(page, "Owner Person");
  await createProject(page, unique("Files"));
  test.skip(!(await filesOn(page)), NO_BUCKET);
  await addTask(page, "Todo", "Shows a clip");

  const composer = page.getByTestId("comment-box");
  await hydrated(composer);
  await composer.fill("Two files:");
  await drop(page, composer, [
    { name: "pixel.png", mime: "image/png", base64: PNG },
    { name: "clip.mp4", mime: "video/mp4", base64: MP4 },
  ]);
  // One line each, in the order they were dropped.
  await expect(composer).toHaveValue(
    /^Two files:\n!\[pixel\.png\]\(\/api\/attachments\/[0-9a-f-]{36}\)\n!\[clip\.mp4\]\(\/api\/attachments\/[0-9a-f-]{36}\)$/,
  );
  await page.getByRole("button", { name: "Comment", exact: true }).click();

  const posted = page.getByTestId("comment-markdown");
  const player = posted.locator("video");
  await expect(player).toHaveAttribute("controls", "");
  await expect(player).toHaveAttribute("preload", "metadata");
  await expect(player).toHaveAttribute("src", /^\/api\/attachments\/[0-9a-f-]{36}$/);
  await expect(posted.locator("img")).toHaveCount(1);

  // Newest first.
  const files = page.getByTestId("files").getByTestId("file");
  await expect(files).toHaveText([/clip\.mp4/, /pixel\.png/]);

  // A mime the board does not take comes back as the server's sentence.
  await drop(page, composer, [{ name: "plan.pdf", mime: "application/pdf", base64: MP4 }]);
  await expect(page.getByTestId("upload-refused")).toHaveText(
    "This board does not take application/pdf files.",
  );
  await expect(composer).toHaveValue("");

  await page.getByRole("button", { name: "Remove pixel.png" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Remove pixel.png?");
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await expect(files).toHaveText([/clip\.mp4/]);
});
