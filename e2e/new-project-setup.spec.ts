import { expect, test } from "@playwright/test";
import { addTask, card, column, createProject, register, unique } from "./helpers";

/*
 * A new project can start with the setup of one of the person's projects:
 * the properties, the views and the card come over, the tasks stay behind.
 */

test("a new project starts with another project's setup, and none of its tasks", async ({
  page,
}, testInfo) => {
  await register(page, "Setup Person");
  const sourceName = unique("Roadmap");
  const sourceId = await createProject(page, sourceName);
  await addTask(page, "Backlog", "A task that stays behind");

  /* Later becomes Someday, and a list view joins the board. */
  const board = await (await page.request.get(`/api/projects/${sourceId}/board`)).json();
  const status = board.properties.find((p: { name: string }) => p.name === "Status");
  const later = status.options.find((o: { name: string }) => o.name === "Later");
  expect(
    (await page.request.patch(`/api/options/${later.id}`, { data: { name: "Someday" } })).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post(`/api/projects/${sourceId}/views`, {
        data: { name: "Everything", kind: "list" },
      })
    ).ok(),
  ).toBe(true);

  await page.goto("/projects/new");
  await expect(page.getByRole("radio", { name: "Default set" })).toBeChecked();
  await page.getByRole("textbox", { name: "Project name" }).fill(unique("Copied"));
  await page.getByRole("radio", { name: "The same setup as another project" }).click();
  /* Its only project is picked already, and the line says what comes over. */
  const tile = page.getByTestId("setup-tile").filter({ hasText: sourceName });
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("setup-line")).toHaveText(
    `From ${sourceName}: 6 properties with their options, 3 views, releases off, sprints off. Tasks, people and webhooks stay behind.`,
  );
  await page.screenshot({ path: testInfo.outputPath("seen-new-project-setup.png") });

  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}/);
  expect(page.url()).not.toContain(sourceId);

  await expect(column(page, "Someday")).toBeVisible();
  await expect(column(page, "Later")).toHaveCount(0);
  await expect(page.getByTestId("view-pill").filter({ hasText: "Everything" })).toBeVisible();
  await expect(card(page, "A task that stays behind")).toHaveCount(0);
  await expect(page.getByTestId("card")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("seen-new-project-copied.png") });
});
