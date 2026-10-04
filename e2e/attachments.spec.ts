import { expect, test } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

/**
 * Files need a bucket, and a server without one says so twice: every
 * attachment route answers 503, and Settings → Project names what to set.
 * The routes themselves are tested with the bucket stubbed, in
 * `attachments-route.test.ts`; CI starts no MinIO. The server decides which
 * answer is right: the dev server in Docker has MinIO, CI has none.
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
