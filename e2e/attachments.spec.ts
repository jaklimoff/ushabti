import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

/**
 * Files need a bucket, and a server without one says so twice: every
 * attachment route answers 503, and Settings → Project names what to set.
 * The server decides which answer is right. CI starts RustFS and points the
 * server at it; a dev server may have no bucket.
 */
const NOTE = "Set S3_BUCKET and its keys to let people attach files.";
const OFF = "Attachments are off, because this server has no S3 bucket set.";

test("Settings says what to set exactly when the attachment routes answer 503", async ({
  page,
}) => {
  await register(page, "Owner Person");
  const projectId = await createProject(page, unique("Files"));

  // Off, the route answers before it looks for the task; on, it finds none.
  const answer = await page.request.get(`/api/tasks/${crypto.randomUUID()}/attachments`);
  const off = answer.status() === 503;
  expect(await answer.json()).toEqual({ error: off ? OFF : "Task not found." });

  await gotoSettings(page, projectId, "project");
  await expect(page.getByRole("textbox", { name: "Project name" })).toBeVisible();
  await expect(page.getByText(NOTE)).toHaveCount(off ? 1 : 0);
});

/* The smallest real PNG: one pixel, so the ready call can read its size. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** The store answers anything at all, or the minute runs out. */
async function storeAnswers(endpoint: string): Promise<boolean> {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    try {
      await fetch(endpoint, { signal: AbortSignal.timeout(2_000) });
      return true;
    } catch {
      await new Promise((done) => setTimeout(done, 1_000));
    }
  }
  return false;
}

test("a PNG goes up through the three calls and comes back through the redirect", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await register(page, "Owner Person");
  const projectId = await createProject(page, unique("Upload"));
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title: "Has a picture" },
  });
  expect(made.ok()).toBeTruthy();
  const { task } = (await made.json()) as { task: { id: string } };

  // 1. Ask for an upload. Off, the server says so, and nothing can be tested.
  const asked = await page.request.post(`/api/tasks/${task.id}/attachments`, {
    data: { name: "dot.png", mime: "image/png", size: PNG.length },
  });
  // CI sets a bucket, so a 503 there is a fault and must fail, not skip.
  // eslint-disable-next-line playwright/no-skipped-test -- no bucket, nothing to upload to
  test.skip(
    !process.env.CI && asked.status() === 503,
    "This server has no bucket, so the upload is not tested.",
  );
  expect(asked.status()).toBe(201);
  const { id, uploadUrl, headers } = (await asked.json()) as {
    id: string;
    uploadUrl: string;
    headers: Record<string, string>;
  };
  // eslint-disable-next-line playwright/no-skipped-test -- USH-181 asks for this skip
  test.skip(
    !(await storeAnswers(new URL(uploadUrl).origin)),
    "The object store did not answer within 60 s, so the upload is not tested.",
  );

  // 2. The bytes go straight to the store. The app makes the bucket as it
  // starts, and on a cold store that can still be under way.
  await expect
    .poll(async () => (await page.request.put(uploadUrl, { headers, data: PNG })).status(), {
      timeout: 30_000,
    })
    .toBe(200);

  // 3. The store is asked whether the bytes are there and are a PNG.
  const ready = await page.request.post(`/api/attachments/${id}/ready`);
  expect(ready.status()).toBe(200);
  const { attachment } = (await ready.json()) as {
    attachment: { width: number | null; height: number | null };
  };
  expect(attachment).toMatchObject({ width: 1, height: 1 });

  // The board's link redirects to a signed one, which hands back the bytes.
  const link = await page.request.get(`/api/attachments/${id}`, { maxRedirects: 0 });
  expect(link.status()).toBe(302);
  const read = await page.request.get(link.headers()["location"]);
  expect(read.status()).toBe(200);
  expect(read.headers()["content-type"]).toBe("image/png");
  expect(Buffer.from(await read.body()).equals(PNG)).toBe(true);
});
