import { expect, test } from "@playwright/test";
import { column, createProject, register, unique } from "./helpers";

/*
 * The only boundary used to sit outside the signed-in frame, so a page that
 * broke took the sidebar and its stream down with it, and Try again drew the
 * same failed answer again. Here the board's own read answers with a board
 * that is not one, so the board breaks on the client.
 */
test("a crash inside a signed-in page keeps the sidebar, and Try again loads it again", async ({
  page,
}, testInfo) => {
  await register(page);
  /* The sidebar is drawn once there is somewhere else to go. */
  await createProject(page, unique("Elsewhere"));
  const projectId = await createProject(page, unique("Crash"));

  const read = `**/api/projects/${projectId}/board*`;
  await page.route(read, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: '{"tasks":[]}' })
      : route.continue(),
  );
  await page.reload();

  const broke = page.getByText("Something broke");
  await expect(broke).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Projects" })).toBeVisible();
  const sidebar = await page.getByRole("navigation", { name: "Projects" }).boundingBox();
  const words = await broke.boundingBox();
  expect(words!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width);
  await page.screenshot({ path: testInfo.outputPath("seen-page-crash.png") });

  await page.unroute(read);
  /* A reload would drop this mark: Try again reads the page, not the tab. */
  await page.evaluate(() => ((window as { stayed?: boolean }).stayed = true));
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(column(page, "Later")).toBeVisible();
  await expect(broke).toHaveCount(0);
  expect(await page.evaluate(() => (window as { stayed?: boolean }).stayed)).toBe(true);
});
