import { expect, test, type Locator, type Page } from "@playwright/test";
import { createProject, overflow, register, unique } from "./helpers";

/*
 * Projects, lists and charts on Home sit in one column width, so their edges
 * line up. Projects once took four to a row while the other two took three.
 */

type Option = { id: string; name: string };
type Property = { id: string; name: string; options: Option[] };

async function lefts(cards: Locator): Promise<number[]> {
  return cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
}

async function homeWith(page: Page) {
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push(await createProject(page, unique(`Grid ${i}`)));
  for (let i = 0; i < 3; i++) {
    const res = await page.request.post("/api/lists", {
      data: { name: `List ${i}`, projectId: ids[i] },
    });
    expect(res.status()).toBe(201);
  }
  const board = await (await page.request.get(`/api/projects/${ids[0]}/board`)).json();
  const status = board.properties.find((p: Property) => p.name === "Status") as Property;
  for (const option of status.options.slice(0, 3)) {
    const res = await page.request.post("/api/charts", {
      data: { projectId: ids[0], propertyId: status.id, optionId: option.id },
    });
    expect(res.ok()).toBe(true);
  }
}

test("projects sit three to a row, on the column edges of lists and charts", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await register(page, "Grid Person");
  await homeWith(page);
  await page.goto("/projects");

  const projects = page.getByTestId("project-card");
  const lists = page.getByTestId("list-card");
  const charts = page.getByTestId("chart");
  await expect(projects).toHaveCount(4);
  await expect(lists).toHaveCount(3);
  await expect(charts).toHaveCount(3);

  await expect(projects.first()).toBeVisible();
  const edges = (await lefts(lists)).slice(0, 3);
  expect(new Set(edges).size).toBe(3);
  /* The fourth project starts a second row, under the first. */
  expect(await lefts(projects)).toEqual([...edges, edges[0]]);
  expect((await lefts(charts)).slice(0, 3)).toEqual(edges);
  const widths = await projects.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().width)),
  );
  const listWidth = await lists
    .first()
    .evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(widths).toEqual([listWidth, listWidth, listWidth, listWidth]);

  /* The rows inside the cards of one row still read level. */
  for (const row of ["project-activity", "project-foot"]) {
    const tops = await page
      .getByTestId(row)
      .evaluateAll((els) =>
        els.slice(0, 3).map((el) => Math.round(el.getBoundingClientRect().top)),
      );
    expect(new Set(tops).size).toBe(1);
  }

  /* Narrower, all three fall to two a row at the same width. */
  await page.setViewportSize({ width: 900, height: 1000 });
  const two = await lefts(lists);
  expect(new Set(two).size).toBe(2);
  expect((await lefts(projects)).slice(0, 2)).toEqual(two.slice(0, 2));
  expect((await lefts(charts)).slice(0, 2)).toEqual(two.slice(0, 2));

  /* A phone stacks one column, and nothing scrolls sideways. */
  await page.setViewportSize({ width: 360, height: 800 });
  expect(new Set(await lefts(projects)).size).toBe(1);
  expect(await overflow(page)).toBe(0);
});
