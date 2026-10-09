import { expect, test } from "@playwright/test";
import { column, register, settles, unique } from "./helpers";

/*
 * An empty section on Home shows one panel that says what goes there, and its
 * first item hands the job back to the small button in the heading. The
 * panels' looks are in `ProjectList.test.tsx`; this walks a new person through.
 */

test("an empty Home offers the first project, then the first list", async ({ page }) => {
  await register(page, "Empty Person");
  await page.goto("/projects");

  /* No projects: one panel makes the first, and lists and charts wait for it. */
  const first = page.getByRole("group", { name: "Create your first project" });
  await expect(first).toContainText("A project is one board of tasks");
  await expect(page.getByRole("button", { name: "+ New project" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Lists" })).toContainText(
    "Gather tasks from your projects in one place. Create a project first.",
  );
  await expect(page.getByRole("group", { name: "Charts" })).toContainText(
    "Count how many tasks enter a column each day. Create a project first.",
  );
  await expect(page.getByTestId("list-new")).toHaveCount(0);
  await expect(page.getByTestId("chart-new")).toHaveCount(0);

  await first.getByRole("button", { name: "New project" }).click();
  const name = unique("Start");
  await page.getByPlaceholder("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}/);
  await expect(column(page, "Backlog")).toBeVisible();

  /* A project, no lists: the wide panel is the link, and the heading has none. */
  await page.goto("/projects");
  await expect(first).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ New project" })).toBeVisible();
  const lists = page.getByTestId("my-lists");
  const panel = lists.getByRole("link", { name: "+ New list" });
  await expect(panel).toHaveAccessibleDescription(/picked by rules, such as everything in Todo/);
  await expect(lists.getByTestId("list-new")).toHaveCount(1);
  const shapes = lists.getByTestId("panel-shapes");
  await expect(shapes).toHaveAttribute("aria-hidden", "true");
  const box = (await panel.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(119);
  await expect(page.getByTestId("my-charts").getByTestId("chart-new")).toContainText(
    "such as how many shipped",
  );

  /* On a phone the words sit above the shapes. */
  await page.setViewportSize({ width: 390, height: 844 });
  const words = (await panel.locator("span").first().boundingBox())!;
  const below = (await shapes.boundingBox())!;
  expect(below.y).toBeGreaterThanOrEqual(words.y + words.height);
  await page.setViewportSize({ width: 1280, height: 800 });

  /* The first list takes the panel away and puts the heading button back. */
  await panel.click();
  await page.waitForURL(/\/lists\/new$/);
  await settles(page, /\/api\/lists$/, () =>
    page.getByTestId("list-add-project").filter({ hasText: name }).click(),
  );
  await page.waitForURL(/\/lists\/[0-9a-f-]{36}\/edit$/);
  await page.goto("/projects");
  await expect(lists.getByTestId("list-card")).toHaveCount(1);
  await expect(lists.getByTestId("panel-shapes")).toHaveCount(0);
  const head = lists.getByTestId("list-new");
  await expect(head).toHaveCount(1);
  await expect(head).toHaveText("+ New list");
  await expect(head).not.toContainText("picked by rules");
});
