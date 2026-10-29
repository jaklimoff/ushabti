import { expect, test, type Page } from "@playwright/test";
import { createProject, gotoSettings, register, unique } from "./helpers";

type Property = {
  id: string;
  name: string;
  config: {
    when?: { propertyId: string; optionIds: string[] };
    defaults?: Record<string, unknown>;
  };
  options: { id: string; name: string }[];
};

async function properties(page: Page, projectId: string): Promise<Property[]> {
  return (await (await page.request.get(`/api/projects/${projectId}/board`)).json()).properties;
}

/*
 * The types grid on the property that holds the types, against a real
 * server: the count it asks with, the rule it writes and the start it edits.
 * What each press sends is `src/components/settings/TypesGrid.test.tsx`.
 */
test.describe("The types grid", () => {
  test("ticks properties against types, asks before it hides, and edits a start", async ({
    page,
  }, testInfo) => {
    await register(page);
    const projectId = await createProject(page, unique("Types grid"));
    const made = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Type", type: "select", options: ["Bug", "Story"] },
    });
    expect(made.ok()).toBeTruthy();
    const pts = await page.request.post(`/api/projects/${projectId}/properties`, {
      data: { name: "Points", type: "number" },
    });
    expect(pts.ok()).toBeTruthy();
    const read = await properties(page, projectId);
    const of = (n: string) => read.find((p) => p.name === n)!;
    const type = of("Type");
    const story = type.options.find((o) => o.name === "Story")!.id;
    const bug = type.options.find((o) => o.name === "Bug")!.id;
    const typed = await page.request.patch(`/api/projects/${projectId}`, {
      data: { typeBy: type.id },
    });
    expect(typed.ok()).toBeTruthy();
    const points = of("Points");
    const task = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title: "A story", values: { [type.id]: story, [points.id]: 3 } },
    });
    expect(task.ok(), await task.text()).toBeTruthy();

    await gotoSettings(page, projectId, "properties");
    const grid = page.getByRole("group", { name: "The types" });
    await expect(grid.getByRole("columnheader")).toHaveText(["Shows on", "Bug", "Story"]);
    const cell = (p: string, t: string) =>
      grid.getByRole("checkbox", { name: `${p} on ${t}`, exact: true });
    await expect(cell("Points", "Story")).toBeChecked();
    await expect(grid.getByText("Unticking takes values away.", { exact: false })).toBeVisible();

    /* Unticking asks with the count, and yes writes the rule. */
    await cell("Points", "Story").click();
    const ask = grid.getByTestId("when-confirm");
    await expect(ask).toContainText("1 task loses its Points.");
    await grid.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("seen-types-grid-ask.png") });
    await ask.getByRole("button", { name: "Yes, hide" }).click();
    await expect(cell("Points", "Story")).not.toBeChecked();
    await expect
      .poll(async () => (await properties(page, projectId)).find((p) => p.id === points.id)!)
      .toMatchObject({ config: { when: { propertyId: type.id } } });

    /* A ticked cell says what it starts as, and pressing it edits the start. */
    await grid.getByRole("button", { name: "Priority on Bug starts empty" }).click();
    const starts = grid.getByTestId("types-grid-starts");
    await starts.getByRole("button", { name: "High" }).click();
    await expect(grid.getByRole("button", { name: "Priority on Bug starts High" })).toContainText(
      "starts High",
    );
    const priority = of("Priority");
    const high = priority.options.find((o) => o.name === "High")!.id;
    await expect
      .poll(async () => {
        const p = (await properties(page, projectId)).find((q) => q.id === priority.id)!;
        return p.config.defaults?.[bug];
      })
      .toBe(high);
    await page.screenshot({ path: testInfo.outputPath("seen-types-grid.png") });

    /* On a phone the grid scrolls inside the panel; the page does not. */
    await page.setViewportSize({ width: 390, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(0);
    await grid.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("seen-types-grid-phone.png") });

    /* Off clears the pointer. */
    await page.setViewportSize({ width: 1280, height: 800 });
    await grid.getByRole("button", { name: "Turn off the types" }).click();
    await expect(page.getByRole("group", { name: "The types" })).toHaveCount(0);
    const after = await (await page.request.get(`/api/projects/${projectId}/board`)).json();
    expect(after.project.typeBy).toBeNull();
  });
});
