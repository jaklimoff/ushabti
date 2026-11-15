import { expect, test } from "@playwright/test";
import { formatDate } from "../src/lib/board";
import { createProject, register, unique } from "./helpers";

type Page = import("@playwright/test").Page;

type Board = {
  today: string;
  properties: { id: string; name: string; type: string; options: { id: string; name: string }[] }[];
};

async function boardOf(page: Page, projectId: string): Promise<Board> {
  return (await page.request.get(`/api/projects/${projectId}/board`)).json();
}

/** A day so many days after another, as YYYY-MM-DD. */
function plus(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/* A new project may already carry a Due. */
async function dateProperty(page: Page, projectId: string, name: string): Promise<string> {
  const had = (await boardOf(page, projectId)).properties.find((p) => p.name === name);
  if (had?.type === "date") return had.id;
  const made = await page.request.post(`/api/projects/${projectId}/properties`, {
    data: { name, type: "date" },
  });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { property: { id: string } }).property.id;
}

async function task(
  page: Page,
  projectId: string,
  title: string,
  values: Record<string, string>,
): Promise<string> {
  const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
    data: { title, values },
  });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { task: { id: string } }).task.id;
}

/*
 * Due is made first, so a new timeline ends on it and starts on Start. Each
 * task is one case of a row: a bar with a checklist, a bar whose end passed,
 * a diamond with no start, a start after its end, and one with no end.
 */
async function plan(page: Page) {
  await register(page);
  const projectId = await createProject(page, unique("Timeline"));
  const due = await dateProperty(page, projectId, "Due");
  const start = await dateProperty(page, projectId, "Start");
  const { today, properties } = await boardOf(page, projectId);
  const status = properties.find((p) => p.name === "Status")!;
  const said = (name: string) => ({
    [status.id]: status.options.find((o) => o.name === name)!.id,
  });

  const bar = await task(page, projectId, "A bar with a list", {
    [start]: plus(today, -2),
    [due]: plus(today, 8),
    ...said("In Progress"),
  });
  for (const [text, done] of [
    ["One", true],
    ["Two", false],
    ["Three", false],
  ] as const) {
    const r = await page.request.post(`/api/tasks/${bar}/checklist`, { data: { text } });
    const { item } = (await r.json()) as { item: { id: string } };
    if (done) await page.request.patch(`/api/checklist/${item.id}`, { data: { done: true } });
  }
  await task(page, projectId, "Late work", {
    [start]: plus(today, -10),
    [due]: plus(today, -3),
    ...said("Todo"),
  });
  await task(page, projectId, "Finished early", {
    [start]: plus(today, -12),
    [due]: plus(today, -6),
    ...said("Done"),
  });
  await task(page, projectId, "One day only", { [due]: plus(today, 5) });
  await task(page, projectId, "Backwards dates", {
    [start]: plus(today, 20),
    [due]: plus(today, 14),
  });
  await task(page, projectId, "No end yet", { [start]: plus(today, 1) });
  return { projectId, today, due, start };
}

async function newView(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}`);
  await page.getByRole("button", { name: "New view" }).click();
  await page.getByLabel("Name of the new view").fill("When");
  const timeline = page
    .getByRole("group", { name: "What the new view shows" })
    .getByRole("button", { name: "Timeline", exact: true });
  await timeline.click();
  await expect(timeline).toHaveAttribute("aria-pressed", "true");
}

/* A chip eases to its colour, so a shot taken at once caught Board still lit.
   With the animations finished, the shot is what a person sees. */
async function shot(page: Page, path: string) {
  await page.mouse.move(0, 0);
  await page.screenshot({ path, animations: "disabled" });
}

/* Makes the timeline from the strip, checking the panel on the way. */
async function makeTimeline(page: Page, path?: string) {
  const made = await plan(page);
  await newView(page, made.projectId);

  // Only the date properties are offered, and the start may be nothing.
  const starts = page.getByRole("group", { name: "Starts on" });
  const ends = page.getByRole("group", { name: "Ends on" });
  await expect(starts.getByRole("button")).toHaveText(["Due", "Start", "Nothing"]);
  await expect(ends.getByRole("button")).toHaveText(["Due", "Start"]);
  await expect(ends.getByRole("button", { name: "Due" })).toHaveAttribute("aria-pressed", "true");
  await expect(starts.getByRole("button", { name: "Start" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Columns by")).toHaveCount(0);
  if (path) await shot(page, path);
  await page.getByRole("button", { name: "Create view" }).click();

  const view = page.getByTestId("timeline-view");
  await expect(view).toBeVisible();
  const row = (title: string) => page.getByTestId("timeline-row").filter({ hasText: title });
  return { ...made, view, row };
}

test.describe("A timeline", () => {
  test("is made from the strip with two date properties, and draws every row case", async ({
    page,
  }, testInfo) => {
    const { today, row } = await makeTimeline(
      page,
      testInfo.outputPath("seen-timeline-new-view.png"),
    );

    // A bar from start to end, filled by its checklist.
    await expect(row("A bar with a list").getByTestId("timeline-bar")).toContainText("1/3");
    await expect(row("A bar with a list").getByTestId("timeline-end")).toHaveText(
      formatDate(plus(today, 8)),
    );
    // The key, and the value the stripe shows.
    await expect(row("A bar with a list").getByTestId("timeline-name")).toContainText(
      "· In Progress",
    );
    // A task that is over: a full bar, and "done" after its day.
    await expect(row("Finished early").getByTestId("timeline-bar")).toHaveAttribute(
      "data-over",
      "true",
    );
    await expect(row("Finished early").getByTestId("timeline-end")).toHaveText(
      `${formatDate(plus(today, -6))} · done`,
    );
    // An end that passed on an open task.
    await expect(row("Late work").getByTestId("timeline-end")).toHaveText(
      `${formatDate(plus(today, -3))} · 3 days over`,
    );
    await expect(row("Late work").getByText("3 days over")).toHaveClass(/timelineLate/);
    // No start: a diamond on the end day.
    await expect(row("One day only").getByTestId("timeline-point")).toBeVisible();
    await expect(row("One day only").getByTestId("timeline-bar")).toHaveCount(0);
    // A start after the end: no bar, and a chip that says so.
    await expect(row("Backwards dates").getByTestId("timeline-bar")).toHaveCount(0);
    await expect(row("Backwards dates").getByTestId("timeline-backwards")).toHaveText(
      `! Starts ${formatDate(plus(today, 20))}, after its end ${formatDate(plus(today, 14))}`,
    );
    await expect(page.getByTestId("roadmap-today")).toBeVisible();

    // No end: under Not scheduled.
    const heading = page.getByTestId("timeline-unscheduled");
    await expect(heading).toContainText("Not scheduled");
    await expect(heading).toContainText("1");
    await expect(heading).toContainText("No end date yet, so they have no place on the days.");
    await expect(row("No end yet")).toHaveAttribute("data-unscheduled", "");

    // The end state is the timeline at rest.
    await shot(page, testInfo.outputPath("seen-timeline.png"));
  });

  test("folds Not scheduled, opens a task, and asks again when its end is deleted", async ({
    page,
  }) => {
    const { due, view, row } = await makeTimeline(page);

    const heading = page.getByTestId("timeline-unscheduled");
    await heading.click();
    await expect(heading).toHaveAttribute("aria-expanded", "false");
    await expect(row("No end yet")).toHaveCount(0);
    await heading.click();
    await expect(row("No end yet")).toBeVisible();

    // A bar opens the task, as a card does.
    await row("A bar with a list").getByTestId("timeline-bar").click();
    await expect(page.getByTestId("task-panel")).toBeVisible();
    await expect(page.getByTestId("task-panel")).toContainText("A bar with a list");

    // A deleted end reads as none, and the timeline asks for another.
    await page.keyboard.press("Escape");
    expect((await page.request.delete(`/api/properties/${due}`)).ok()).toBe(true);
    await page.reload();
    await expect(view.getByText("Pick the date the bars end on.")).toBeVisible();
    await view
      .getByRole("group", { name: "Ends on" })
      .getByRole("button", { name: "Start" })
      .click();
    await expect(page.getByTestId("timeline-unscheduled")).toBeVisible();
  });

  test("cannot be made without a date property", async ({ page }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Timeline"));
    for (const p of (await boardOf(page, projectId)).properties.filter((p) => p.type === "date"))
      expect((await page.request.delete(`/api/properties/${p.id}`)).ok()).toBe(true);
    await newView(page, projectId);
    await expect(page.getByText("Create a date property first.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create view" })).toBeDisabled();
    await shot(page, testInfo.outputPath("seen-timeline-no-dates.png"));
  });
});
